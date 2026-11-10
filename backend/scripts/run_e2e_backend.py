"""Start the backend for the browser tests on a freshly reset `astra_e2e` schema of the TEST database.

The test database URL comes from ASTRA_TEST_DATABASE_URL (environment or .env.test.local). It is passed to the
app in-process, never on a command line, and the script refuses to run against the app's own DATABASE_URL server.
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import psycopg  # noqa: E402
import uvicorn  # noqa: E402
from psycopg.conninfo import conninfo_to_dict, make_conninfo  # noqa: E402

from app.settings import app_database_url, same_database_server, setting  # noqa: E402

SCHEMA = "astra_e2e"


def main() -> None:
    test_url = setting("ASTRA_TEST_DATABASE_URL", ".env.test.local")
    if not test_url:
        sys.exit("Set ASTRA_TEST_DATABASE_URL (or create .env.test.local) for the browser tests.")
    if same_database_server(test_url, app_database_url()):
        sys.exit("Refusing to run browser tests against the app's own DATABASE_URL server. Use a separate test database.")
    if "-pooler" in (conninfo_to_dict(test_url).get("host") or "").lower():
        sys.exit("ASTRA_TEST_DATABASE_URL must be a direct (non-pooled) connection: remove '-pooler' from the host.")
    with psycopg.connect(test_url, autocommit=True, connect_timeout=30) as connection:
        connection.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
        connection.execute(f'CREATE SCHEMA "{SCHEMA}"')
    os.environ["DATABASE_URL"] = make_conninfo(test_url, options=f"-c search_path={SCHEMA}")  # the app migrates it at start-up
    port = int(os.environ.get("ASTRA_E2E_PORT", "8011"))
    uvicorn.run("app.main:create_app", factory=True, host="127.0.0.1", port=port, app_dir=str(BACKEND))


if __name__ == "__main__":
    main()
