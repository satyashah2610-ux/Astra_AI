import asyncio
import json
import logging
import os
import threading
from io import BytesIO
from pathlib import Path, PureWindowsPath
from uuid import uuid4

from contextlib import asynccontextmanager, suppress

import psycopg

from fastapi import Depends, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pypdf import PdfReader
from .auth import create_auth
from .database import clean_database_url, write_lock
from .email import sender_from_env
from .events import trusted_proxies
from .models import RenameAgreement, SaveMarks
from .files import create_files_router
from .lifecycle import FileStatus
from .naming import unique_name
from .sample import make_sample
from .security import SecurityMiddleware, parse_allowed_hosts
from .settings import load_env_files
from .reminders import reminder_loop
from .signing import create_signing_router
from .storage import Storage, utc_now

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


def create_app(data_dir: Path | None = None, database_url: str | None = None, email_sender=None) -> FastAPI:
    load_env_files()  # local development: .env.local / .env fill in missing settings, never override real ones
    trusted_proxies()  # a mistyped value stops the app here instead of quietly trusting no proxy
    pages = frontend_dir()  # checked before connecting to the database
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set. Put your PostgreSQL connection string in .env.local "
                           "(DATABASE_URL=postgresql://...) or in the environment before starting the backend.")
    url = clean_database_url(url)  # before connecting: a malformed address never reaches a log line
    storage = Storage(Path(data_dir or os.environ.get("ASTRA_DATA_DIR") or Path(__file__).resolve().parents[1] / "data"), url)
    storage.initialize()

    @asynccontextmanager
    async def lifespan(_app):
        stop = threading.Event()
        reminders = asyncio.create_task(reminder_loop(storage, sender, stop)) if sender is not None else None
        yield
        stop.set()
        if reminders is not None:
            reminders.cancel()
            with suppress(asyncio.CancelledError):
                await reminders
        storage.close()  # release database connections at shutdown
    database = storage.database

    def item(row):
        if row is None:
            raise HTTPException(404, "Agreement not found.")
        result = dict(row)
        result.pop("organization_id", None)  # internal: never sent to the browser
        result["marks"] = json.loads(result["marks"])
        return result

    def fetch(db, identifier, organization_id):
        """An agreement of this company only: another company's id is simply not found."""
        return db.execute("SELECT * FROM agreements WHERE id = %s AND organization_id = %s", (identifier, organization_id)).fetchone()

    def find(identifier, organization_id):
        with database() as db:
            return item(fetch(db, identifier, organization_id))

    sender = email_sender if email_sender is not None else sender_from_env()
    auth_router, current_user = create_auth(storage, sender)
    Staff = Depends(current_user)  # every staff endpoint needs a logged-in user; signing endpoints don't

    app = FastAPI(title="Astra Sign", version="0.1.0", lifespan=lifespan)
    app.state.storage = storage
    app.add_middleware(SecurityMiddleware,
                       allowed_hosts=parse_allowed_hosts(os.environ.get("ASTRA_ALLOWED_HOSTS")),
                       body_limit=MAX_BYTES + 1024 * 1024,  # the PDF plus multipart overhead
                       body_limit_message="PDF must be 20 MB or smaller.",
                       small_body_prefixes=("/api/signing", "/api/auth"))  # public endpoints: 1 MiB is ample

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/agreements")
    def list_agreements(account: dict = Staff):
        with database() as db:
            return [item(row) for row in db.execute("SELECT * FROM agreements WHERE organization_id = %s ORDER BY created_at DESC, id DESC",
                                                     (account["organization_id"],))]

    @app.post("/api/agreements", status_code=201)
    def upload_agreement(file: UploadFile, account: dict = Staff):
        filename = PureWindowsPath((file.filename or "agreement.pdf").replace("\x00", "")).name
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
        now = utc_now()
        pdf_path = storage.template_pdf(identifier)
        pdf_path.write_bytes(content)
        try:
            with database() as db:
                # Allocate and insert under one write lock, including parallel uploads.
                write_lock(db)
                used_names = {row['name'].casefold() for row in db.execute("SELECT name FROM agreements WHERE organization_id = %s",
                                                                             (account["organization_id"],))}
                name = unique_name(filename[:-4][:200] or "Untitled agreement", used_names)
                try:
                    db.execute("INSERT INTO agreements (id, organization_id, name, filename, page_count, created_at, updated_at) "
                               "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                               (identifier, account["organization_id"], name, filename[:255], count, now, now))
                except psycopg.errors.UniqueViolation as exc:
                    # Python's casefold() and PostgreSQL's lower() can disagree on rare characters.
                    raise HTTPException(409, "An agreement with a very similar name already exists. Rename the PDF and upload it again.") from exc
        except Exception:
            pdf_path.unlink(missing_ok=True)
            raise
        logger.info("Agreement uploaded id=%s pages=%s", identifier, count)
        return find(identifier, account["organization_id"])

    @app.get("/api/agreements/{identifier}")
    def get_agreement(identifier: str, account: dict = Staff):
        return find(identifier, account["organization_id"])

    @app.get("/api/agreements/{identifier}/pdf")
    def get_pdf(identifier: str, account: dict = Staff):
        agreement = find(identifier, account["organization_id"])
        path = storage.template_pdf(agreement["id"])
        if not path.is_file():
            raise HTTPException(404, "The PDF file is unavailable. Upload the agreement again.")
        return FileResponse(path, media_type="application/pdf", filename=agreement["filename"], content_disposition_type="inline")

    @app.delete("/api/agreements/{identifier}", status_code=204)
    def delete_agreement(identifier: str, account: dict = Staff):
        try:
            with database() as db:
                # Serialize deletion against saves and other deletion requests.
                write_lock(db)
                agreement = item(fetch(db, identifier, account["organization_id"]))
                drafts = db.execute("SELECT COUNT(*) FROM files WHERE agreement_id = %s AND status = %s",
                                    (identifier, FileStatus.DRAFT)).fetchone()[0]
                if drafts:
                    # Sent files keep their own copy; drafts would be left pointing at nothing.
                    raise HTTPException(409, f"This agreement is used by {drafts} draft file{'s' if drafts != 1 else ''}. "
                                             "Send or delete those files first.")
                db.execute("DELETE FROM agreements WHERE id = %s", (identifier,))
                # An unlink error rolls back the row removal, retaining all markings.
                storage.template_pdf(agreement["id"]).unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Agreement file deletion failed id=%s", identifier)
            raise HTTPException(503, "Could not delete the PDF. Close any program using the file and try again.") from exc
        logger.info("Agreement deleted id=%s", identifier)
        return Response(status_code=204)

    @app.patch("/api/agreements/{identifier}")
    def rename_agreement(identifier: str, body: RenameAgreement, account: dict = Staff):
        """A taken name (case ignored, this company only) gets " (1)", " (2)"..., like an upload. Marks and version are untouched."""
        with database() as db:
            write_lock(db)
            item(fetch(db, identifier, account["organization_id"]))
            used = {row["name"].casefold() for row in db.execute("SELECT name FROM agreements WHERE organization_id = %s AND id <> %s",
                                                                  (account["organization_id"], identifier))}
            try:
                db.execute("UPDATE agreements SET name = %s, updated_at = %s WHERE id = %s", (unique_name(body.name, used), utc_now(), identifier))
            except psycopg.errors.UniqueViolation as exc:
                raise HTTPException(409, "An agreement with a very similar name already exists. Choose another name.") from exc
            renamed = item(fetch(db, identifier, account["organization_id"]))
        logger.info("Agreement renamed id=%s", identifier)
        return renamed

    @app.put("/api/agreements/{identifier}/marks")
    def save_marks(identifier: str, body: SaveMarks, account: dict = Staff):
        with database() as db:
            write_lock(db)  # serialize against deletion so a vanished agreement gives 404, not 409
            agreement = item(fetch(db, identifier, account["organization_id"]))
            if any(mark.page > agreement["page_count"] for mark in body.marks):
                raise HTTPException(422, "An item on the template refers to a page that does not exist.")
            marks = json.dumps(body.stored_marks())
            result = db.execute("UPDATE agreements SET marks = %s, version = version + 1, updated_at = %s WHERE id = %s AND version = %s",
                                (marks, utc_now(), identifier, body.version))
            if result.rowcount != 1:
                raise HTTPException(409, "This agreement was changed in another tab. Reload the saved version before editing again.")
            updated = item(fetch(db, identifier, account["organization_id"]))
        logger.info("Agreement markings saved id=%s version=%s count=%s", identifier, updated["version"], len(body.marks))
        return updated

    app.include_router(auth_router)
    app.include_router(create_files_router(storage, current_user, sender))
    app.include_router(create_signing_router(storage, sender))

    @app.get("/api/sample-agreement.pdf")
    def sample():
        return Response(make_sample(), media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="Sample services agreement.pdf"'})

    if pages is not None:
        serve_pages(app, pages)
    return app


def frontend_dir() -> Path | None:
    """ASTRA_FRONTEND_DIR: the built web pages (`frontend/dist`), served by this app when hosted. Unset in local
    development, where Vite serves them. A folder without index.html is a broken build: the app refuses to start."""
    value = os.environ.get("ASTRA_FRONTEND_DIR", "").strip()
    if not value:
        return None
    folder = Path(value).resolve()
    if not (folder / "index.html").is_file():
        raise RuntimeError(f"ASTRA_FRONTEND_DIR ({folder}) has no index.html: build the frontend first (npm run build).")
    return folder


# Script types must be exact (the nosniff header makes browsers refuse anything else); some systems map .js to text/plain.
SCRIPT_TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm"}
FILE_FOLDERS = {"assets": "public, max-age=31536000, immutable",  # Vite puts the content hash in these names
                "pdf-assets": "public, max-age=86400"}  # the PDF viewer's fonts and maps: fixed names


def serve_pages(app: FastAPI, folder: Path) -> None:
    """Registered after every API route. Built files are served as they are, cached; any other address gets the app's
    page (never cached), which shows the right screen (/sign, /reset-password, ...). A missing file under the build's
    file folders is a 404, so a script never receives HTML; /api addresses stay JSON 404s; nothing outside the folder
    is ever served."""
    index = folder / "index.html"

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def page(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found.")
        target = (folder / path).resolve()
        top = path.split("/", 1)[0]
        if path and target.is_relative_to(folder) and target.is_file():
            return FileResponse(target, media_type=SCRIPT_TYPES.get(target.suffix),
                                headers={"Cache-Control": FILE_FOLDERS.get(top, "no-store")})
        if top in FILE_FOLDERS:
            raise HTTPException(404, "Not found.")
        return FileResponse(index, media_type="text/html")
