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
from .signed_pdf import Certificate, Stamp, build_signed_pdf
from .storage import Storage, utc_now

logger = logging.getLogger("astrasign.signed")
ITEM_LABELS = {"signature": "Signature", "initials": "Initials", "name": "Name", "date": "Date signed",
               "text": "Text", "check": "Tick", "dot": "Dot"}


def signer_stamps(items: list, signature_png: bytes, initials_png: bytes | None, name: str, date_text: str):
    """The signer's placed items as stamps, plus (page, item, value) rows for the certificate."""
    stamps, rows = [], []
    for item in items:
        kind = item["type"]
        if kind in ("signature", "initials"):
            stamps.append(Stamp(kind="image", page=item["page"], box=item, image=signature_png if kind == "signature" else initials_png))
            value = "Signed" if kind == "signature" else "Initialled"
        elif kind in ("name", "date", "text"):
            value = {"name": name, "date": date_text}.get(kind, item.get("text", ""))
            stamps.append(Stamp(kind="text", page=item["page"], box=item, text=value))
        else:
            stamps.append(Stamp(kind=kind, page=item["page"], box=item))
            value = "Ticked" if kind == "check" else "Marked"
        rows.append((str(item["page"]), ITEM_LABELS[kind], value))
    return stamps, tuple(rows)
_build_locks: dict[str, threading.Lock] = {}  # one build per file at a time, so
# concurrent downloads can't produce two versions, while other files' builds are not held up


def remove_signed_pdf(storage: Storage, file_id: str) -> None:
    """Delete a file's signed PDF and any unfinished build of it. Takes the build lock, so a build already
    running finishes first and its PDF is removed too (a build starting later finds the file deleted: 404)."""
    with _build_locks.setdefault(file_id, threading.Lock()):
        storage.signed_pdf(file_id).unlink(missing_ok=True)
        for partial in storage.signed.glob(f"{file_id}.*.partial"):
            partial.unlink(missing_ok=True)


def ensure_signed_pdf(storage: Storage, file_id: str) -> Path:
    """Path of the file's signed PDF, building it on first use. 404 if not signed; 503 if it can't be built."""
    target = storage.signed_pdf(file_id)
    if target.is_file():
        return target
    with _build_locks.setdefault(file_id, threading.Lock()):  # setdefault is atomic: one lock per file
        if target.is_file():
            return target
        with storage.database() as db:
            row = db.execute("SELECT * FROM files WHERE id = %s", (file_id,)).fetchone()
            if row is None or row["status"] != FileStatus.SIGNED:
                raise HTTPException(404, "This agreement has not been signed yet.")
            signature = db.execute("SELECT * FROM signatures WHERE file_id = %s", (file_id,)).fetchone()
            placed = db.execute("SELECT * FROM signer_items WHERE file_id = %s", (file_id,)).fetchone()  # absent for older signings
            events = list_events(db, file_id)
        try:
            signature_png = storage.signature_png(file_id).read_bytes()
            initials_path = storage.initials_png(file_id)
            stamps, rows = signer_stamps(json.loads(placed["items"]) if placed else [], signature_png,
                                         initials_path.read_bytes() if initials_path.is_file() else None,
                                         signature["name"], placed["date_text"] if placed else "")
            certificate = Certificate(
                document_name=row["document_name"], document_sha256=row["document_sha256"], file_id=file_id,
                signer_name=row["signer_name"], signer_email=row["signer_email"], signature_name=signature["name"],
                method=signature["method"], consent_text=signature["consent_text"], signed_at=signature["signed_at"],
                ip=signature["ip"], user_agent=signature["user_agent"], events=events, generated_at=utc_now(),
                signer_items=rows)
            content = build_signed_pdf(storage.document_pdf(file_id).read_bytes(), json.loads(row["marks"]),
                                       signature_png, certificate, stamps=stamps)
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
