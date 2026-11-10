"""Versioned schema changes: numbered .sql files applied once, in order, recorded in schema_migrations."""
from pathlib import Path

from .database import utc_now

MIGRATIONS_DIR = Path(__file__).parent / "schema"
MIGRATION_LOCK_KEY = 0x4D494752  # "MIGR": two servers starting together can't both migrate


def migrate(connection) -> list[str]:
    """Apply every pending migration; return the names applied (empty if already up to date)."""
    applied: list[str] = []
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK_KEY,))
        connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
        done = {row[0] for row in connection.execute("SELECT version FROM schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.stem in done:
                continue
            connection.execute(path.read_text(encoding="utf-8"))
            connection.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (%s, %s)", (path.stem, utc_now()))
            applied.append(path.stem)
    return applied
