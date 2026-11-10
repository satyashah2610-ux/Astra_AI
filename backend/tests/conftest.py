"""Test set-up: tests run in their own throwaway schema on a dedicated test database, never production.

The test database URL comes from ASTRA_TEST_DATABASE_URL (environment or the git-ignored .env.test.local).
Use a *direct* (non-pooled) connection: tests select their schema with a connection option, which the
pooled endpoint doesn't support. Locally this is a Neon branch named `test`; any PostgreSQL works.

Safety, in layers:
1. Tests refuse to start if the test URL points at the same server as the app's DATABASE_URL.
2. Tests only create, empty and drop their own `astra_test_<random>` schema; other tables are never touched.
"""
import uuid

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from app.migrations import migrate
from app.settings import app_database_url, same_database_server, setting


def refuse_production(test_url: str, production_url: str | None) -> None:
    """Tests create and drop schemas: never let them run against the app's own database server."""
    if same_database_server(test_url, production_url):
        raise pytest.UsageError("Refusing to run tests: the test database URL points at the same server as the app's DATABASE_URL. "
                                "Use a separate test database (for example a Neon branch named 'test') in ASTRA_TEST_DATABASE_URL.")


def schema_url(base_url: str, schema: str) -> str:
    """A connection that sees only `schema` (and creates tables there)."""
    if "-pooler" in endpoint_raw(base_url):
        raise pytest.UsageError("ASTRA_TEST_DATABASE_URL must be a direct (non-pooled) connection: remove '-pooler' from the host.")
    return make_conninfo(base_url, options=f"-c search_path={schema}")


def endpoint_raw(url: str) -> str:
    return (conninfo_to_dict(url).get("host") or "").lower()


TEST_URL = setting("ASTRA_TEST_DATABASE_URL", ".env.test.local")
PRODUCTION_URL = app_database_url()


def create_schema() -> tuple[str, str]:
    if not TEST_URL:
        raise pytest.UsageError("Set ASTRA_TEST_DATABASE_URL (or create .env.test.local) to a test PostgreSQL database.")
    refuse_production(TEST_URL, PRODUCTION_URL)
    schema = f"astra_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(TEST_URL, autocommit=True, connect_timeout=30) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    return schema, schema_url(TEST_URL, schema)


def drop_schema(schema: str) -> None:
    with psycopg.connect(TEST_URL, autocommit=True, connect_timeout=30) as connection:
        connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))


@pytest.fixture(scope="session")
def test_schema():
    """One migrated schema for the whole run; each test starts with its tables emptied."""
    schema, url = create_schema()
    try:
        with psycopg.connect(url) as connection:
            migrate(connection)
        yield url
    finally:
        drop_schema(schema)


@pytest.fixture(autouse=True)
def database(test_schema, monkeypatch, tmp_path_factory):
    """Empty tables for this test, exposed to the app as DATABASE_URL."""
    with psycopg.connect(test_schema) as connection:
        tables = [row[0] for row in connection.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'")]
        if tables:
            connection.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY").format(sql.SQL(", ").join(map(sql.Identifier, tables))))
    monkeypatch.setenv("DATABASE_URL", test_schema)
    # Never read the developer's real .env / .env.local (they hold the production URL).
    monkeypatch.setenv("ASTRA_ENV_DIR", str(tmp_path_factory.mktemp("no-env-files")))
    # FastAPI's TestClient sends Host: testserver; allow it alongside the real defaults.
    monkeypatch.setenv("ASTRA_ALLOWED_HOSTS", "testserver,127.0.0.1,localhost")
    # Tests never send real email: no Resend key, no outbox, no app address unless a test sets them.
    for name in ("RESEND_API_KEY", "ASTRA_EMAIL_FROM", "ASTRA_EMAIL_OUTBOX", "ASTRA_APP_URL", "ASTRA_TRUSTED_PROXIES", "ASTRA_REMINDER_MINUTES"):
        monkeypatch.delenv(name, raising=False)
    yield test_schema


@pytest.fixture
def empty_database():
    """A brand-new, unmigrated schema, for testing the migration runner itself."""
    schema, url = create_schema()
    try:
        yield url
    finally:
        drop_schema(schema)
