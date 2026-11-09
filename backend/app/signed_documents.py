"""The stored signed PDF for each signed file: built once, then served unchanged."""
import json
import logging
import os
import tempfile
import threading
from pathlib import Path

from fastapi import HTTPException

from .events import list_events
from .lifecycle import FileStatus
from .signed_pdf import Certificate, build_signed_pdf
from .storage import Storage, utc_now

logger = logging.getLogger("astrasign.signed")
_build_locks: dict[str, threading.Lock] = {}  # one build per file at a time, so
# concurrent downloads can't produce two versions, while other files' builds are not held up


def ensure_signed_pdf(storage: Storage, file_id: str) -> Path:
    """Path of the file's signed PDF, building it on first use. 404 if not signed; 503 if it can't be built."""
    target = storage.signed_pdf(file_id)
    if target.is_file():
        return target
    with _build_locks.setdefault(file_id, threading.Lock()):  # setdefault is atomic: one lock per file
        if target.is_file():
            return target
        with storage.database() as db:
            row = db.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
            if row is None or row["status"] != FileStatus.SIGNED:
                raise HTTPException(404, "This agreement has not been signed yet.")
            signature = db.execute("SELECT * FROM signatures WHERE file_id = ?", (file_id,)).fetchone()
            events = list_events(db, file_id)
        try:
            certificate = Certificate(
                document_name=row["document_name"], document_sha256=row["document_sha256"], file_id=file_id,
                signer_name=row["signer_name"], signer_email=row["signer_email"], signature_name=signature["name"],
                method=signature["method"], consent_text=signature["consent_text"], signed_at=signature["signed_at"],
                ip=signature["ip"], user_agent=signature["user_agent"], events=events, generated_at=utc_now())
            content = build_signed_pdf(storage.document_pdf(file_id).read_bytes(), json.loads(row["marks"]),
                                       storage.signature_png(file_id).read_bytes(), certificate)
        except Exception as exc:
            logger.exception("Signed PDF could not be built id=%s", file_id)
            raise HTTPException(503, "The signed PDF could not be created. The signature is recorded; "
                                     "try again or contact support with the file reference.") from exc
        descriptor, partial = tempfile.mkstemp(dir=target.parent, prefix=f"{file_id}.", suffix=".partial")
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
            os.replace(partial, target)  # atomic: readers never see a half-written file
        except OSError as exc:
            Path(partial).unlink(missing_ok=True)
            logger.exception("Signed PDF could not be stored id=%s", file_id)
            raise HTTPException(503, "The signed PDF could not be saved. The signature is recorded; "
                                     "try again or contact support with the file reference.") from exc
        logger.info("Signed PDF built id=%s bytes=%s", file_id, len(content))
    return target


def signed_pdf_filename(document_name: str) -> str:
    return f"{document_name} - signed.pdf"
