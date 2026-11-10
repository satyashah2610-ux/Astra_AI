"""PostgreSQL access: rows, the app-wide write lock and the connection pool."""
from datetime import datetime, timezone

from psycopg_pool import ConnectionPool

WRITE_LOCK_KEY = 0x41535452  # "ASTR": serializes check-then-write transactions, like SQLite's BEGIN IMMEDIATE did
LOCK_TIMEOUT = "15s"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Row(dict):
    """A result row readable by column name (row["name"]) or position (row[0]), like sqlite3.Row."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []

    def make(values):
        return Row(zip(names, values))
    return make


def write_lock(connection) -> None:
    """Take the app-wide write lock for the rest of this transaction (released at commit or rollback)."""
    connection.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
    connection.execute("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK_KEY,))


def connect_pool(url: str, max_size: int = 10) -> ConnectionPool:
    """A small pool. Prepared statements are off because Neon's pooled endpoint (PgBouncer) doesn't keep them."""
    return ConnectionPool(url, min_size=1, max_size=max_size, timeout=30, open=True,
                          kwargs={"row_factory": row_factory, "prepare_threshold": None})
