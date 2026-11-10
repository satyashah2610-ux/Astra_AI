"""Settings loading, the row type, the migration runner and the production-safety guards."""
import os
import threading
from pathlib import Path

import psycopg
import pytest

from app.database import Row, row_factory
from app.main import create_app
from app.migrations import MIGRATIONS_DIR, migrate
from app.settings import load_env_files
from tests.conftest import refuse_production


# --- .env loading --------------------------------------------------------------------------------------

def test_env_files_fill_in_missing_settings_with_env_local_winning(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("SHARED=from-env\nONLY_ENV=yes\n", encoding="utf-8")
    (tmp_path / ".env.local").write_text("# local secrets\n\nSHARED='from-local'\nONLY_LOCAL=\"quoted value\"\n", encoding="utf-8")
    for name in ("SHARED", "ONLY_ENV", "ONLY_LOCAL"):
        monkeypatch.delenv(name, raising=False)
    load_env_files(tmp_path)
    assert os.environ["SHARED"] == "from-local"
    assert os.environ["ONLY_ENV"] == "yes"
    assert os.environ["ONLY_LOCAL"] == "quoted value"


def test_env_files_never_override_the_real_environment(tmp_path, monkeypatch):
    (tmp_path / ".env.local").write_text("DATABASE_URL=postgresql://from-file\n", encoding="utf-8")
    monkeypatch.setenv("DATABASE_URL", "postgresql://already-set")
    load_env_files(tmp_path)
    assert os.environ["DATABASE_URL"] == "postgresql://already-set"


def test_missing_env_files_are_fine(tmp_path):
    load_env_files(tmp_path / "nowhere")


def test_app_explains_a_missing_database_url(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL")
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        create_app(tmp_path)


# --- rows ------------------------------------------------------------------------------------------------

def test_rows_can_be_read_by_name_or_position_and_copied_to_a_dict():
    row = Row({"id": "a1", "name": "MIND"})
    assert row["name"] == "MIND"
    assert row[0] == "a1" and row[1] == "MIND"
    assert dict(row) == {"id": "a1", "name": "MIND"}


def test_queries_return_rows(database):
    with psycopg.connect(database, row_factory=row_factory) as connection:
        row = connection.execute("SELECT 1 AS one, 'two' AS two").fetchone()
    assert row["two"] == "two" and row[0] == 1


# --- migrations ---------------------------------------------------------------------------------------

def migration_files():
    return sorted(path.stem for path in Path(MIGRATIONS_DIR).glob("*.sql"))


def test_migrations_are_numbered_in_order():
    names = migration_files()
    assert names and names[0].startswith("0001_")
    assert [name[:4] for name in names] == [f"{n:04d}" for n in range(1, len(names) + 1)]


def applied(url):
    with psycopg.connect(url) as connection:
        return [row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")]


def test_migrate_creates_the_schema_once_and_records_every_version(empty_database):
    with psycopg.connect(empty_database) as connection:
        assert migrate(connection) == migration_files()
    with psycopg.connect(empty_database) as connection:
        assert migrate(connection) == []  # already up to date
        tables = {row[0] for row in connection.execute("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()")}
    assert {"agreements", "files", "file_events", "signatures", "signer_items", "schema_migrations"} <= tables
    assert applied(empty_database) == migration_files()


def test_two_servers_starting_together_migrate_exactly_once(empty_database):
    results, errors = [], []

    def run():
        try:
            with psycopg.connect(empty_database) as connection:
                results.append(migrate(connection))
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
    assert errors == []
    assert sorted(results, key=len) == [[], migration_files()]


# --- production safety -------------------------------------------------------------------------------

PRODUCTION = "postgresql://user:pw@ep-cool-name-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require"


@pytest.mark.parametrize("url", ["postgresql://user:pw@ep-cool-name.us-west-2.aws.neon.tech/neondb?sslmode=require",
                                 "postgresql://other:pw@EP-COOL-NAME-POOLER.us-west-2.aws.neon.tech/neondb"])
def test_tests_refuse_to_run_against_the_apps_own_database(url):
    with pytest.raises(pytest.UsageError, match="same server"):
        refuse_production(url, PRODUCTION)


def test_a_separate_test_database_is_allowed():
    refuse_production("postgresql://user:pw@ep-shiny-test.us-west-2.aws.neon.tech/neondb", PRODUCTION)
    refuse_production("postgresql://astra:astra@127.0.0.1:54329/postgres", None)


def test_tests_run_in_their_own_schema_and_never_read_the_real_env_files():
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        assert connection.execute("SELECT current_schema()").fetchone()[0].startswith("astra_test_")
    assert Path(os.environ["ASTRA_ENV_DIR"]).name.startswith("no-env-files")


def test_read_env_file_returns_values_without_touching_the_environment(tmp_path, monkeypatch):
    from app.settings import read_env_file
    (tmp_path / ".env.test.local").write_text("ASTRA_TEST_DATABASE_URL=postgresql://x\n", encoding="utf-8")
    monkeypatch.delenv("ASTRA_TEST_DATABASE_URL", raising=False)
    assert read_env_file(tmp_path / ".env.test.local") == {"ASTRA_TEST_DATABASE_URL": "postgresql://x"}
    assert "ASTRA_TEST_DATABASE_URL" not in os.environ
    assert read_env_file(tmp_path / "missing") == {}
