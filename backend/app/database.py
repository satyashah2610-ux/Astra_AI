"""PostgreSQL access: rows, the app-wide write lock and the connection pool."""
from datetime import datetime, timezone

import logging
from urllib.parse import urlsplit

from psycopg.conninfo import conninfo_to_dict
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


INVALID_URL = ("DATABASE_URL is not a valid PostgreSQL connection string. It should start with postgresql:// "
               "and have nothing around it (no quotes, no 'psql'). Its value is not shown because it contains the password.")


def clean_database_url(url: str) -> str:
    """The address as pasted, minus surrounding spaces and quotes (a hosting dashboard keeps them; a postgresql://
    address never starts or ends with one). A malformed address is refused with a message that never includes it."""
    value = url.strip()
    unquoted = value.strip("'\"").strip()
    if unquoted.startswith(("postgresql://", "postgres://")):  # the key=value form may legitimately end in a quote
        value = unquoted
    try:
        conninfo_to_dict(value)
    except Exception:
        raise RuntimeError(INVALID_URL) from None  # the parser's own message quotes the address
    return value


class HidePassword(logging.Filter):
    def __init__(self, secrets: tuple[str, ...]):
        super().__init__()
        self.secrets = secrets

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if any(secret in message for secret in self.secrets):
            for secret in self.secrets:
                message = message.replace(secret, "***")
            record.msg, record.args = message, ()
        return True


def hide_password_in_logs(url: str) -> None:
    """The database driver and its pool log connection errors, sometimes with the address in them: show *** instead
    of the password in anything they log, both as written in the address (%40 for @) and decoded."""
    password = conninfo_to_dict(url).get("password")
    if not password:
        return
    written = urlsplit(url).password if url.startswith(("postgresql://", "postgres://")) else None
    secrets = tuple(sorted({password, written} - {None, ""}, key=len, reverse=True))
    for name in ("psycopg", "psycopg.pool"):  # a logger's filters don't apply to its children's records
        logger = logging.getLogger(name)
        if not any(isinstance(f, HidePassword) and f.secrets == secrets for f in logger.filters):
            logger.addFilter(HidePassword(secrets))


def connect_pool(url: str, max_size: int = 10) -> ConnectionPool:
    """A small pool. Prepared statements are off because Neon's pooled endpoint (PgBouncer) doesn't keep them."""
    hide_password_in_logs(url)
    # No connection is kept open while idle, so the free database can sleep: unused ones close within about 2 minutes
    # (the pool shrinks on a fixed 60 s tick), well inside the 5 idle minutes. Each is checked before use, since one
    # left from before the database slept may have been dropped.
    return ConnectionPool(url, min_size=0, max_size=max_size, max_idle=60, timeout=30, open=True, check=ConnectionPool.check_connection,
                          kwargs={"row_factory": row_factory, "prepare_threshold": None})
