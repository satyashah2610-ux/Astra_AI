-- Accounts: companies (organizations), their staff users, and login sessions.
-- Agreements and files now belong to one organization; every staff query filters by it.

CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,  -- stored lower-case
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX users_unique_email ON users (lower(email));
CREATE INDEX users_organization ON users (organization_id);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,  -- SHA-256 of the cookie value; the token itself is never stored
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Rows created before accounts existed are kept, under a placeholder company nobody can log in to.
INSERT INTO organizations (id, name, created_at)
SELECT 'legacy', 'Data from before accounts', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
WHERE EXISTS (SELECT 1 FROM agreements) OR EXISTS (SELECT 1 FROM files);

ALTER TABLE agreements ADD COLUMN organization_id TEXT REFERENCES organizations (id) ON DELETE CASCADE;
UPDATE agreements SET organization_id = 'legacy' WHERE organization_id IS NULL;
ALTER TABLE agreements ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX agreements_organization ON agreements (organization_id);

ALTER TABLE files ADD COLUMN organization_id TEXT REFERENCES organizations (id) ON DELETE CASCADE;
UPDATE files SET organization_id = 'legacy' WHERE organization_id IS NULL;
ALTER TABLE files ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX files_organization ON files (organization_id);

-- Agreement names are unique within a company, not across companies.
DROP INDEX agreements_unique_name;
CREATE UNIQUE INDEX agreements_unique_name ON agreements (organization_id, lower(name));
