-- Initial schema: the same tables the app used on SQLite, in PostgreSQL form.
-- Timestamps are ISO-8601 text and marks/items are JSON text, so API output is unchanged.

CREATE TABLE agreements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    marks TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
-- Library names are unique regardless of case (the app picks "(1)", "(2)" suffixes with a stricter casefold()).
CREATE UNIQUE INDEX agreements_unique_name ON agreements (lower(name));

CREATE TABLE files (
    id TEXT PRIMARY KEY,
    seq BIGINT GENERATED ALWAYS AS IDENTITY,  -- stable tie-breaker for "newest first"
    title TEXT NOT NULL,
    client_name TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    signer_email TEXT NOT NULL,
    agreement_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'signed')),
    document_name TEXT,
    document_sha256 TEXT,
    page_count INTEGER,
    marks TEXT,
    token_hash TEXT UNIQUE,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT,
    viewed_at TEXT,
    signed_at TEXT
);
CREATE INDEX files_agreement ON files (agreement_id);
CREATE INDEX files_status ON files (status);

CREATE TABLE file_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('created', 'sent', 'link_reissued', 'viewed', 'signed')),
    at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
);
CREATE INDEX file_events_file ON file_events (file_id);

CREATE TABLE signatures (
    file_id TEXT PRIMARY KEY,
    method TEXT NOT NULL CHECK (method IN ('typed', 'drawn')),
    name TEXT NOT NULL,
    image_sha256 TEXT NOT NULL,
    consent_text TEXT NOT NULL,
    signed_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
);

CREATE TABLE signer_items (
    file_id TEXT PRIMARY KEY,
    items TEXT NOT NULL DEFAULT '[]',
    initials_method TEXT CHECK (initials_method IN ('typed', 'drawn')),
    initials_sha256 TEXT,
    date_text TEXT NOT NULL
);
