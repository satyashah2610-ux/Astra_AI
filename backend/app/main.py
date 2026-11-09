import json
import logging
import os
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path, PureWindowsPath
from uuid import uuid4

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pypdf import PdfReader
from .models import SaveMarks
from .files import create_files_router
from .lifecycle import FileStatus
from .naming import unique_name
from .sample import make_sample
from .signing import create_signing_router
from .storage import Storage

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 100
logger = logging.getLogger("astrasign.agreements")


def validate_pdf(content: bytes) -> int:
    if not content.startswith(b"%PDF-"):
        raise HTTPException(400, "Upload a valid PDF document.")
    try:
        reader = PdfReader(BytesIO(content))
        if reader.is_encrypted:
            raise HTTPException(400, "Password-protected PDFs are not supported. Upload an unlocked copy.")
        count = len(reader.pages)
        if not 1 <= count <= MAX_PAGES:
            raise HTTPException(400, "PDFs must contain between 1 and 100 pages.")
        for page in reader.pages:
            if float(page.cropbox.width) <= 0 or float(page.cropbox.height) <= 0:
                raise HTTPException(400, "This PDF has an invalid page size.")
        return count
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, "This PDF could not be read. Export a new PDF and try again.") from exc


def create_app(data_dir: Path | None = None) -> FastAPI:
    storage = Storage(Path(data_dir or os.environ.get("ASTRA_DATA_DIR") or Path(__file__).resolve().parents[1] / "data"))
    storage.initialize()
    uploads = storage.uploads
    database = storage.database

    def item(row):
        if row is None:
            raise HTTPException(404, "Agreement not found.")
        result = dict(row)
        result["marks"] = json.loads(result["marks"])
        return result

    def find(identifier):
        with database() as db:
            return item(db.execute("SELECT * FROM agreements WHERE id = ?", (identifier,)).fetchone())

    app = FastAPI(title="Astra Sign", version="0.1.0")

    @app.middleware("http")
    async def request_limits(request, call_next):
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > MAX_BYTES + 1024 * 1024):
            return JSONResponse({"detail": "PDF must be 20 MB or smaller."}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/agreements")
    def list_agreements():
        with database() as db:
            return [item(row) for row in db.execute("SELECT * FROM agreements ORDER BY created_at DESC, id DESC")]

    @app.post("/api/agreements", status_code=201)
    def upload_agreement(file: UploadFile):
        filename = PureWindowsPath(file.filename or "agreement.pdf").name
        try:
            if not filename.lower().endswith(".pdf"):
                raise HTTPException(400, "Only PDF files are supported.")
            content = file.file.read(MAX_BYTES + 1)
        finally:
            file.file.close()
        if len(content) > MAX_BYTES:
            raise HTTPException(413, "PDF must be 20 MB or smaller.")
        count = validate_pdf(content)
        identifier = str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        pdf_path = uploads / f"{identifier}.pdf"
        pdf_path.write_bytes(content)
        try:
            with database() as db:
                # Allocate and insert under one write lock, including parallel uploads.
                db.execute("BEGIN IMMEDIATE")
                used_names = {row['name'].casefold() for row in db.execute("SELECT name FROM agreements")}
                name = unique_name(filename[:-4][:200] or "Untitled agreement", used_names)
                db.execute("INSERT INTO agreements (id, name, filename, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                           (identifier, name, filename[:255], count, now, now))
        except Exception:
            pdf_path.unlink(missing_ok=True)
            raise
        logger.info("Agreement uploaded id=%s pages=%s", identifier, count)
        return find(identifier)

    @app.get("/api/agreements/{identifier}")
    def get_agreement(identifier: str):
        return find(identifier)

    @app.get("/api/agreements/{identifier}/pdf")
    def get_pdf(identifier: str):
        agreement = find(identifier)
        path = uploads / f"{agreement['id']}.pdf"
        if not path.is_file():
            raise HTTPException(404, "The PDF file is unavailable. Upload the agreement again.")
        return FileResponse(path, media_type="application/pdf", filename=agreement["filename"], content_disposition_type="inline")

    @app.delete("/api/agreements/{identifier}", status_code=204)
    def delete_agreement(identifier: str):
        try:
            with database() as db:
                # Serialize deletion against saves and other deletion requests.
                db.execute("BEGIN IMMEDIATE")
                agreement = item(db.execute("SELECT * FROM agreements WHERE id = ?", (identifier,)).fetchone())
                drafts = db.execute("SELECT COUNT(*) FROM files WHERE agreement_id = ? AND status = ?",
                                    (identifier, FileStatus.DRAFT)).fetchone()[0]
                if drafts:
                    # Sent files keep their own copy; drafts would be left pointing at nothing.
                    raise HTTPException(409, f"This agreement is used by {drafts} draft file{'s' if drafts != 1 else ''}. "
                                             "Send or delete those files first.")
                db.execute("DELETE FROM agreements WHERE id = ?", (identifier,))
                # An unlink error rolls back the row removal, retaining all markings.
                (uploads / f"{agreement['id']}.pdf").unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Agreement file deletion failed id=%s", identifier)
            raise HTTPException(503, "Could not delete the PDF. Close any program using the file and try again.") from exc
        logger.info("Agreement deleted id=%s", identifier)
        return Response(status_code=204)

    @app.put("/api/agreements/{identifier}/marks")
    def save_marks(identifier: str, body: SaveMarks):
        with database() as db:
            agreement = item(db.execute("SELECT * FROM agreements WHERE id = ?", (identifier,)).fetchone())
            if any(mark.page > agreement["page_count"] for mark in body.marks):
                raise HTTPException(422, "A signature box refers to a page that does not exist.")
            marks = json.dumps([mark.model_dump() for mark in body.marks])
            result = db.execute("UPDATE agreements SET marks = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
                                (marks, datetime.now(timezone.utc).isoformat(), identifier, body.version))
            if result.rowcount != 1:
                raise HTTPException(409, "This agreement was changed in another tab. Reload the saved version before editing again.")
            updated = item(db.execute("SELECT * FROM agreements WHERE id = ?", (identifier,)).fetchone())
        logger.info("Agreement markings saved id=%s version=%s count=%s", identifier, updated["version"], len(body.marks))
        return updated

    app.include_router(create_files_router(storage))
    app.include_router(create_signing_router(storage))

    @app.get("/api/sample-agreement.pdf")
    def sample():
        return Response(make_sample(), media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="Sample services agreement.pdf"'})

    return app
