"""/api/files: one job or case for one client, and its signing link.

Business rules live in lifecycle.py (status transitions), tokens.py (link secrets)
and models.py (input validation). This module handles HTTP and persistence.
"""
import hashlib
import json
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response

from .database import write_lock
from .events import list_events, record_event
from .lifecycle import FileStatus, can_transition
from .models import FileCreate, FileUpdate
from .signed_documents import ensure_signed_pdf, signed_pdf_filename
from .signed_pdf import mark_type, print_text_marks
from .storage import Storage, utc_now
from .tokens import hash_token, new_token

logger = logging.getLogger("astrasign.files")

PUBLIC_FIELDS = ("id", "title", "client_name", "signer_name", "signer_email", "agreement_id", "status",
                 "document_name", "document_sha256", "page_count", "version",
                 "created_at", "updated_at", "sent_at", "viewed_at", "signed_at")
LINK_STATUSES = {FileStatus.SENT, FileStatus.VIEWED}


def public_file(row) -> dict:
    """API view of a file. Never includes the token hash."""
    if row is None:
        raise HTTPException(404, "File not found.")
    result = {key: row[key] for key in PUBLIC_FIELDS}
    result["field_count"] = sum(mark_type(m) == "signature" for m in json.loads(row["marks"])) if row["marks"] else 0
    return result


def signing_path(token: str) -> str:
    """The secret goes in the URL fragment: browsers never send it to any server or in a Referer."""
    return f"/sign#{token}"


def create_files_router(storage: Storage, current_user) -> APIRouter:
    router = APIRouter(prefix="/api/files", tags=["files"])

    Staff = Depends(current_user)  # every endpoint here needs a logged-in user

    def fetch(db, identifier, organization_id):
        """A file of this company only: another company's id is simply not found."""
        return db.execute("SELECT * FROM files WHERE id = %s AND organization_id = %s", (identifier, organization_id)).fetchone()

    def require_agreement(db, agreement_id, organization_id):
        agreement = db.execute("SELECT * FROM agreements WHERE id = %s AND organization_id = %s", (agreement_id, organization_id)).fetchone()
        if agreement is None:
            raise HTTPException(422, "Choose an agreement that exists in your library.")
        return agreement

    @router.post("", status_code=201)
    def create_file(body: FileCreate, account: dict = Staff):
        identifier, now = str(uuid4()), utc_now()
        with storage.database() as db:
            write_lock(db)  # the agreement cannot be deleted between the check and the insert
            require_agreement(db, body.agreement_id, account["organization_id"])
            db.execute("""INSERT INTO files (id, organization_id, title, client_name, signer_name, signer_email, agreement_id,
                          status, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                       (identifier, account["organization_id"], body.title, body.client_name, body.signer_name, body.signer_email,
                        body.agreement_id, FileStatus.DRAFT, now, now))
            record_event(db, identifier, "created", at=now)
            created = public_file(fetch(db, identifier, account["organization_id"]))
        logger.info("File created id=%s", identifier)
        return created

    @router.get("")
    def list_files(account: dict = Staff):
        with storage.database() as db:
            return [public_file(row) for row in db.execute("SELECT * FROM files WHERE organization_id = %s ORDER BY created_at DESC, seq DESC", (account["organization_id"],))]

    @router.get("/{identifier}")
    def get_file(identifier: str, account: dict = Staff):
        with storage.database() as db:
            return public_file(fetch(db, identifier, account["organization_id"]))

    @router.patch("/{identifier}")
    def update_file(identifier: str, body: FileUpdate, account: dict = Staff):
        changes = body.model_dump(exclude_unset=True, exclude={"version"})
        with storage.database() as db:
            write_lock(db)
            current = public_file(fetch(db, identifier, account["organization_id"]))
            if current["status"] != FileStatus.DRAFT:
                raise HTTPException(409, "Only draft files can be edited. This file has already been sent.")
            if "agreement_id" in changes:
                require_agreement(db, changes["agreement_id"], account["organization_id"])
            assignments = ", ".join(f"{column} = %s" for column in changes)  # columns come from the model, not the client
            result = db.execute(f"UPDATE files SET {assignments}, version = version + 1, updated_at = %s "
                                "WHERE id = %s AND version = %s AND status = %s",
                                (*changes.values(), utc_now(), identifier, body.version, FileStatus.DRAFT))
            if result.rowcount != 1:
                raise HTTPException(409, "This file was changed in another tab. Reload it before editing again.")
            return public_file(fetch(db, identifier, account["organization_id"]))

    @router.delete("/{identifier}", status_code=204)
    def delete_file(identifier: str, account: dict = Staff):
        try:
            with storage.database() as db:
                write_lock(db)
                current = public_file(fetch(db, identifier, account["organization_id"]))
                if current["status"] == FileStatus.SIGNED:
                    raise HTTPException(409, "Signed files are kept as a record and cannot be deleted.")
                db.execute("DELETE FROM files WHERE id = %s", (identifier,))
                db.execute("DELETE FROM file_events WHERE file_id = %s", (identifier,))
                # An unlink error rolls the row deletion back.
                storage.document_pdf(identifier).unlink(missing_ok=True)
        except OSError as exc:
            raise HTTPException(503, "Could not delete the file's document. Close any program using it and try again.") from exc
        logger.info("File deleted id=%s", identifier)
        return Response(status_code=204)

    @router.post("/{identifier}/send")
    def send_file(identifier: str, account: dict = Staff):
        token, target, written = new_token(), storage.document_pdf(identifier), False
        try:
            with storage.database() as db:
                write_lock(db)  # serializes concurrent sends of the same file
                current = public_file(fetch(db, identifier, account["organization_id"]))
                if not can_transition(current["status"], FileStatus.SENT):
                    raise HTTPException(409, "This file has already been sent. Reissue the link to send it again.")
                agreement = require_agreement(db, current["agreement_id"], account["organization_id"])
                marks = json.loads(agreement["marks"])
                if not any(mark_type(mark) == "signature" for mark in marks):
                    raise HTTPException(409, "Add at least one signature box to the agreement before sending.")
                source = storage.template_pdf(agreement["id"])
                if not source.is_file():
                    raise HTTPException(422, "The agreement PDF is unavailable. Upload the agreement again.")
                try:
                    content = print_text_marks(source.read_bytes(), marks)  # company text becomes part of the document
                except Exception as exc:
                    logger.exception("Company text could not be printed id=%s", identifier)
                    raise HTTPException(422, "The agreement's text could not be printed on the PDF. Check the template and try again.") from exc
                target.write_bytes(content)
                written = True
                now = utc_now()
                db.execute("""UPDATE files SET status = %s, document_name = %s, document_sha256 = %s, page_count = %s,
                              marks = %s, token_hash = %s, sent_at = %s, updated_at = %s, version = version + 1
                              WHERE id = %s""",
                           (FileStatus.SENT, agreement["name"], hashlib.sha256(content).hexdigest(), agreement["page_count"],
                            json.dumps([m for m in marks if mark_type(m) != "text"]), hash_token(token), now, now, identifier))
                record_event(db, identifier, "sent", at=now)
                sent = public_file(fetch(db, identifier, account["organization_id"]))
        except BaseException:
            if written:
                target.unlink(missing_ok=True)
            raise
        logger.info("File sent id=%s fields=%s", identifier, sent["field_count"])
        return {"file": sent, "signing_path": signing_path(token)}

    @router.post("/{identifier}/link")
    def reissue_link(identifier: str, account: dict = Staff):
        token = new_token()
        with storage.database() as db:
            write_lock(db)
            current = public_file(fetch(db, identifier, account["organization_id"]))
            if current["status"] not in LINK_STATUSES:
                raise HTTPException(409, "Send the file first." if current["status"] == FileStatus.DRAFT
                                    else "This file is already signed; its link can no longer be used.")
            now = utc_now()
            db.execute("UPDATE files SET token_hash = %s, updated_at = %s, version = version + 1 WHERE id = %s",
                       (hash_token(token), now, identifier))
            record_event(db, identifier, "link_reissued", at=now)
            reissued = public_file(fetch(db, identifier, account["organization_id"]))
        logger.info("File link reissued id=%s", identifier)
        return {"file": reissued, "signing_path": signing_path(token)}

    @router.get("/{identifier}/events")
    def file_events(identifier: str, account: dict = Staff):
        with storage.database() as db:
            public_file(fetch(db, identifier, account["organization_id"]))
            return list_events(db, identifier)

    @router.get("/{identifier}/signed.pdf")
    def file_signed_pdf(identifier: str, account: dict = Staff):
        with storage.database() as db:
            current = public_file(fetch(db, identifier, account["organization_id"]))
        path = ensure_signed_pdf(storage, identifier)
        return FileResponse(path, media_type="application/pdf", filename=signed_pdf_filename(current["document_name"]),
                            content_disposition_type="attachment")

    @router.get("/{identifier}/pdf")
    def file_pdf(identifier: str, account: dict = Staff):
        with storage.database() as db:
            current = public_file(fetch(db, identifier, account["organization_id"]))
        path = storage.document_pdf(identifier)
        if current["status"] == FileStatus.DRAFT or not path.is_file():
            raise HTTPException(404, "This file has not been sent yet, so it has no document.")
        return FileResponse(path, media_type="application/pdf", filename=f"{current['document_name']}.pdf",
                            content_disposition_type="inline")

    return router
