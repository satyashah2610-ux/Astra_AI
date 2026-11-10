-- Signing emails queued per company, counted for the daily limit (an account can't use our domain to mass-mail).

CREATE TABLE signing_emails (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    at TEXT NOT NULL
);
CREATE INDEX signing_emails_organization ON signing_emails (organization_id, at);
