"""/api/signing: the public signing flow. The signer's only credential is the link secret.

The secret is sent in the X-Signing-Token header rather than the URL path, so it never
appears in server access logs.
"""
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import FileResponse

from .database import write_lock
from .events import record_event, request_origin
from .lifecycle import FileStatus, can_transition
from .links import app_url
from .models import SignSubmission
from .reminders import notify_signed
from .signatures import SignatureImageError, decode_signature_png
from .signed_documents import ensure_signed_pdf, signed_pdf_filename
from .signed_pdf import mark_type
from .storage import Storage, utc_now
from .tokens import hash_token

logger = logging.getLogger("astrasign.signing")

CONSENT_TEXT = ("I agree to sign this agreement electronically. I understand that my electronic signature "
                "is legally binding, the same as a handwritten signature.")
INVALID_LINK = "This signing link is invalid or has been replaced. Ask the sender for a new link."


def signing_date(utc_offset_minutes: int) -> str:
    """The signing date as the signer's calendar shows it, e.g. '09 Nov 2026'."""
    return (datetime.now(timezone.utc) + timedelta(minutes=utc_offset_minutes)).strftime("%d %b %Y")


def first_open_of_link(db, row, token: str, now: str) -> bool:
    """Mark this link (the file's current one, or a reminder's) as opened. True only the first time, so reloads add nothing."""
    token_hash = hash_token(token)
    if token_hash == row["token_hash"]:
        result = db.execute("UPDATE files SET link_opened_at = %s WHERE id = %s AND link_opened_at IS NULL", (now, row["id"]))
    else:
        result = db.execute("UPDATE signing_links SET opened_at = %s WHERE token_hash = %s AND opened_at IS NULL", (now, token_hash))
    return result.rowcount == 1


def signer_view(row) -> dict:
    """What the signer may see. No email, internal title, IDs or token data."""
    marks = json.loads(row["marks"])
    return {
        "document_name": row["document_name"],
        "signer_name": row["signer_name"],
        "page_count": row["page_count"],
        "marks": [m for m in marks if mark_type(m) == "signature"],
        "comments": [{key: m[key] for key in ("id", "page", "x", "y", "width", "height", "text")} for m in marks if mark_type(m) == "comment"],
        "status": row["status"],
        "sent_at": row["sent_at"],
        "signed_at": row["signed_at"],
        "consent_text": CONSENT_TEXT,
    }


def create_signing_router(storage: Storage, email_sender=None) -> APIRouter:
    router = APIRouter(prefix="/api/signing", tags=["signing"])

    def lookup(db, token: str | None):
        """Resolve a link secret (the sent link, or one from a reminder) to its sent file. One generic 404 for every failure."""
        token_hash = hash_token(token) if token else None
        row = db.execute("""SELECT * FROM files WHERE token_hash = %s
                            OR id = (SELECT file_id FROM signing_links WHERE token_hash = %s)""",
                         (token_hash, token_hash)).fetchone() if token else None
        if row is None or row["status"] == FileStatus.DRAFT:
            raise HTTPException(404, INVALID_LINK)
        return row

    def reload(db, file_id):
        return db.execute("SELECT * FROM files WHERE id = %s", (file_id,)).fetchone()

    @router.get("")
    def get_signing(x_signing_token: str | None = Header(default=None)):
        with storage.database() as db:
            return signer_view(lookup(db, x_signing_token))

    @router.post("/view")
    def mark_viewed(request: Request, x_signing_token: str | None = Header(default=None)):
        with storage.database() as db:
            write_lock(db)
            row = lookup(db, x_signing_token)
            now = utc_now()
            # Each link's first open is recorded: the original, a reissued one, or a reminder's. Only the first ever makes the file Viewed.
            if row["status"] != FileStatus.SIGNED and first_open_of_link(db, row, x_signing_token, now):
                if row["status"] == FileStatus.SENT:
                    db.execute("UPDATE files SET status = %s, viewed_at = %s, updated_at = %s, version = version + 1 WHERE id = %s",
                               (FileStatus.VIEWED, now, now, row["id"]))
                record_event(db, row["id"], "viewed", request, now)
                logger.info("File viewed id=%s", row["id"])
            return signer_view(reload(db, row["id"]))

    @router.get("/pdf")
    def signing_pdf(x_signing_token: str | None = Header(default=None)):
        with storage.database() as db:
            row = lookup(db, x_signing_token)
        path = storage.document_pdf(row["id"])
        if not path.is_file():
            raise HTTPException(404, "The document is unavailable. Ask the sender for a new link.")
        return FileResponse(path, media_type="application/pdf", filename=f"{row['document_name']}.pdf",
                            content_disposition_type="inline")

    @router.post("/sign")
    def sign(body: SignSubmission, request: Request, background: BackgroundTasks, x_signing_token: str | None = Header(default=None)):
        try:
            image = decode_signature_png(body.image)
            initials = decode_signature_png(body.initials.image) if body.initials else None
        except SignatureImageError as exc:
            raise HTTPException(422, str(exc)) from exc
        ip, user_agent = request_origin(request)
        target = initials_target = None
        try:
            with storage.database() as db:
                write_lock(db)  # two clicks or two tabs: exactly one signature
                row = lookup(db, x_signing_token)
                if not can_transition(row["status"], FileStatus.SIGNED):
                    raise HTTPException(409, "This agreement has already been signed.")
                if any(item.page > row["page_count"] for item in body.items):
                    raise HTTPException(422, "An item is on a page that isn't in this document.")
                target = storage.signature_png(row["id"])
                target.write_bytes(image)
                if initials is not None:
                    initials_target = storage.initials_png(row["id"])
                    initials_target.write_bytes(initials)
                now = utc_now()
                db.execute("""INSERT INTO signatures (file_id, method, name, image_sha256, consent_text, signed_at, ip, user_agent)
                              VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                           (row["id"], body.method, body.name, hashlib.sha256(image).hexdigest(), CONSENT_TEXT, now, ip, user_agent))
                db.execute("""INSERT INTO signer_items (file_id, items, initials_method, initials_sha256, date_text)
                              VALUES (%s, %s, %s, %s, %s)""",
                           (row["id"], json.dumps([item.model_dump(exclude_none=True) for item in body.items]),
                            body.initials.method if body.initials else None,
                            hashlib.sha256(initials).hexdigest() if initials is not None else None,
                            signing_date(body.utc_offset_minutes)))
                db.execute("""UPDATE files SET status = %s, signed_at = %s, updated_at = %s, version = version + 1, remind_at = NULL
                              WHERE id = %s AND status IN (%s, %s)""",
                           (FileStatus.SIGNED, now, now, row["id"], FileStatus.SENT, FileStatus.VIEWED))
                record_event(db, row["id"], "signed", request, now)
                signed = signer_view(reload(db, row["id"]))
        except BaseException:
            for written in (target, initials_target):
                if written is not None:
                    written.unlink(missing_ok=True)
            raise
        logger.info("File signed id=%s method=%s items=%s", row["id"], body.method, len(body.items))
        try:
            ensure_signed_pdf(storage, row["id"])  # build now; a failure is retried on the first download
        except Exception:
            logger.warning("Signed PDF build deferred id=%s", row["id"], exc_info=True)
        if email_sender is not None:  # after the response: the signer never waits on our email provider
            try:
                base_url = row["link_base"] or app_url(request)  # files sent before reminders existed have no stored address
            except HTTPException:  # never turn a completed signature into an error
                logger.warning("Signed notice skipped: no app address id=%s", row["id"])
            else:
                background.add_task(notify_signed, storage, email_sender, row["id"], base_url)
        return signed

    @router.get("/signed.pdf")
    def signed_pdf(x_signing_token: str | None = Header(default=None)):
        with storage.database() as db:
            row = lookup(db, x_signing_token)
        path = ensure_signed_pdf(storage, row["id"])
        return FileResponse(path, media_type="application/pdf", filename=signed_pdf_filename(row["document_name"]),
                            content_disposition_type="attachment")

    return router
