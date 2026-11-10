"""Data directory layout and database access. Shared by every router."""
from contextlib import contextmanager
from pathlib import Path

from .database import connect_pool, utc_now  # noqa: F401  (utc_now is imported from here by the routers)
from .migrations import migrate


class Storage:
    """Owns the data directory and the database: uploaded templates, sent-document snapshots, signatures and signed PDFs."""

    def __init__(self, root: Path, database_url: str):
        self.root = Path(root)
        self.database_url = database_url
        self.pool = None
        self.uploads = self.root / "uploads"
        self.documents = self.root / "documents"
        self.signatures = self.root / "signatures"
        self.signed = self.root / "signed"

    def initialize(self) -> None:
        self.uploads.mkdir(parents=True, exist_ok=True)
        self.documents.mkdir(parents=True, exist_ok=True)
        self.signatures.mkdir(parents=True, exist_ok=True)
        self.signed.mkdir(parents=True, exist_ok=True)
        self.pool = connect_pool(self.database_url)
        with self.pool.connection() as connection:
            migrate(connection)

    def close(self) -> None:
        if self.pool is not None:
            self.pool.close()

    @contextmanager
    def database(self):
        """One pooled connection per unit of work; commits on success, rolls back on any exception."""
        with self.pool.connection() as connection:
            yield connection

    def template_pdf(self, agreement_id: str) -> Path:
        return self.uploads / f"{agreement_id}.pdf"

    def document_pdf(self, file_id: str) -> Path:
        return self.documents / f"{file_id}.pdf"

    def signature_png(self, file_id: str) -> Path:
        return self.signatures / f"{file_id}.png"

    def initials_png(self, file_id: str) -> Path:
        return self.signatures / f"{file_id}-initials.png"

    def signed_pdf(self, file_id: str) -> Path:
        return self.signed / f"{file_id}.pdf"
