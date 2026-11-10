"""Direct database access for tests that check what was stored (uses this test's DATABASE_URL)."""
import os

import psycopg

from app.database import row_factory


def rows(query: str, params: tuple = ()) -> list:
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=row_factory) as connection:
        return connection.execute(query, params).fetchall()


def row(query: str, params: tuple = ()):
    found = rows(query, params)
    return found[0] if found else None


def value(query: str, params: tuple = ()):
    found = row(query, params)
    return found[0] if found else None


def execute(query: str, params: tuple = ()) -> None:
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        connection.execute(query, params)
