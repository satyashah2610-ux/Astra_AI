# Design 07: PostgreSQL (Neon)

Status: implemented.

## Problem

SQLite is one file on one machine. A product for hundreds of users across many companies needs a managed database with backups that survives redeploys and can be shared by more than one server process. The app moves to PostgreSQL on Neon. PDFs stay on disk for now; moving them to object storage (R2) is a separate step before deployment.

## High-level design

```
FastAPI app ──► psycopg connection pool ──► DATABASE_URL
                                             ├─ local dev / production: Neon (pooled endpoint, SSL)
                                             └─ tests: throwaway PostgreSQL 18 in Docker, one fresh database per test
```

- **Same SQL, same behaviour.** The data model, API and every rule stay the same; only the database engine changes. The existing ~300 backend tests are the regression suite and run against real PostgreSQL.
- **Versioned schema.** `backend/app/schema/NNNN_name.sql` files are applied in order at start-up and recorded in `schema_migrations`, so the schema lives in git like the code and production upgrades are repeatable.
- **Write serialization.** SQLite's `BEGIN IMMEDIATE` (one writer at a time) becomes a transaction-scoped PostgreSQL advisory lock, taken at the same points. Check-then-write races stay impossible (the existing race tests prove it), and the lock is released automatically at commit or rollback.
- **Configuration.** `DATABASE_URL` comes from the environment. For local development the app reads `.env.local` / `.env` (both git-ignored) without ever overriding a variable that is already set.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Database | PostgreSQL on Neon | Stay on SQLite; MySQL | Managed backups, branching for dev, standard for production web apps; free tier fits the take-home. |
| Driver | psycopg 3 + psycopg_pool | SQLAlchemy ORM | The code already uses explicit SQL; an ORM would rewrite every query for no user-visible gain. |
| Migrations | Small built-in runner over numbered `.sql` files | Alembic | Alembic is built around SQLAlchemy metadata we don't use. The runner is ~40 lines, tested, and takes a lock so two servers starting at once can't both migrate. |
| Writer lock | `pg_advisory_xact_lock` (one app-wide key), 15 s lock timeout | Row locks per table | Same guarantees as before with minimal risk during the move; writes are short. Finer-grained locks can come if write volume grows. |
| Neon pooler | Prepared statements disabled (`prepare_threshold=None`), settings via `SET LOCAL` | Startup `options` | Neon's pooled endpoint (PgBouncer, transaction mode) rejects startup options and session-level prepared statements. |
| Timestamps / JSON | Keep ISO-8601 `TEXT` and JSON `TEXT` columns | `timestamptz` / `jsonb` | API output stays byte-for-byte identical. Converting types is a later, separate migration. |
| Ordering | Identity column `seq` as tie-breaker | SQLite `rowid` | PostgreSQL has no `rowid`. |
| Agreement names | Unique index on `lower(name)`; suffixes chosen by Python `casefold()` | `COLLATE NOCASE` | `casefold()` is stricter than `lower()`, so the index can never reject a name the app chose. |
| Tests | Fresh database per test, cloned from a migrated template, on Docker PostgreSQL 18 | Run tests on Neon | Fast, isolated, works offline and in CI. Tests refuse to run against a Neon (`neon.tech`) URL, so production data can't be wiped by accident. |
| Legacy duplicate-name repair | Dropped from start-up | Keep | It repaired old SQLite data; PostgreSQL's unique index makes duplicates impossible. A one-off import script handles old local data. |

## Low-level design

| Module | Responsibility |
|---|---|
| `app/settings.py` | `load_env_files(root)`: read `KEY=value` lines from `.env.local` then `.env`, set only variables not already in the environment. |
| `app/database.py` | `Row` (dict that also allows `row[0]`), `row_factory`, `write_lock(db)` (advisory lock + `SET LOCAL lock_timeout`), `connect_pool(url)`. |
| `app/migrations.py` + `app/schema/*.sql` | `migrate(connection)`: lock, create `schema_migrations`, apply pending files in order, each in its own transaction. |
| `app/storage.py` | `Storage(root, database_url)`: owns the pool (closed at shutdown) and the PDF folders. `database()` yields a pooled connection inside a transaction (commit on success, rollback on error). |
| `app/main.py` | `create_app(data_dir=None, database_url=None)`; clear error if no `DATABASE_URL`; lifespan closes the pool. |
| `docker-compose.yml` | `postgres:18` for tests and offline development on port 54329. |
| `tests/conftest.py` | Per-test database from a migrated template; sets `DATABASE_URL`; refuses Neon URLs. |

## Test plan

**New unit tests:** `.env` loading (precedence, comments, quotes, never overriding), `Row` access by name and position, the migration runner (applies in order, records versions, idempotent, a second concurrent runner waits and applies nothing twice), the missing-`DATABASE_URL` error, the test guard against Neon URLs.

**Regression:** every existing backend test (agreements, files, signing, signed PDFs, items, security, races, concurrency) runs on PostgreSQL. Tests that read the database directly use a small PostgreSQL helper instead of `sqlite3`.

**Browser tests:** the Playwright backend starts against a freshly reset test database each run.
