"""Data directory layout, SQLite access and schema. Shared by every router."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .naming import ensure_unique_names

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS agreements (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, filename TEXT NOT NULL,
        page_count INTEGER NOT NULL, marks TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL, client_name TEXT NOT NULL,
        signer_name TEXT NOT NULL, signer_email TEXT NOT NULL,
        agreement_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'signed')),
        document_name TEXT, document_sha256 TEXT, page_count INTEGER, marks TEXT,
        token_hash TEXT UNIQUE,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        sent_at TEXT, viewed_at TEXT, signed_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS files_agreement ON files(agreement_id)",
    "CREATE INDEX IF NOT EXISTS files_status ON files(status)",
    """CREATE TABLE IF NOT EXISTS file_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('created', 'sent', 'link_reissued', 'viewed', 'signed')),
        at TEXT NOT NULL, ip TEXT, user_agent TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS file_events_file ON file_events(file_id)",
    """CREATE TABLE IF NOT EXISTS signatures (
        file_id TEXT PRIMARY KEY,
        method TEXT NOT NULL CHECK (method IN ('typed', 'drawn')),
        name TEXT NOT NULL, image_sha256 TEXT NOT NULL, consent_text TEXT NOT NULL,
        signed_at TEXT NOT NULL, ip TEXT, user_agent TEXT
    )""",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    """Owns the data directory: SQLite database, uploaded templates, sent-document snapshots and signatures."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.uploads = self.root / "uploads"
        self.documents = self.root / "documents"
        self.signatures = self.root / "signatures"
        self.database_path = self.root / "agreements.sqlite3"

    def initialize(self) -> None:
        self.uploads.mkdir(parents=True, exist_ok=True)
        self.documents.mkdir(parents=True, exist_ok=True)
        self.signatures.mkdir(parents=True, exist_ok=True)
        with self.database() as db:
            db.execute("PRAGMA journal_mode=WAL")
            for statement in SCHEMA:
                db.execute(statement)
            ensure_unique_names(db)

    @contextmanager
    def database(self):
        """One connection per unit of work; commits on success, rolls back on any exception."""
        connection = sqlite3.connect(self.database_path, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def template_pdf(self, agreement_id: str) -> Path:
        return self.uploads / f"{agreement_id}.pdf"

    def document_pdf(self, file_id: str) -> Path:
        return self.documents / f"{file_id}.pdf"

    def signature_png(self, file_id: str) -> Path:
        return self.signatures / f"{file_id}.png"
