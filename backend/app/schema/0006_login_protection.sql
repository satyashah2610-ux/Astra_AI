-- Login protection: confirmed email addresses and failed-login limits.

ALTER TABLE users ADD COLUMN email_confirmed_at TEXT;
UPDATE users SET email_confirmed_at = created_at;  -- accounts made before this rule count as confirmed

CREATE TABLE email_confirmations (
    token_hash TEXT PRIMARY KEY,  -- SHA-256 of the emailed secret
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE INDEX email_confirmations_user ON email_confirmations (user_id, created_at);

CREATE TABLE login_failures (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL,  -- lower-case, as typed (may not be an account)
    ip TEXT,
    at TEXT NOT NULL
);
CREATE INDEX login_failures_email ON login_failures (email, at);
CREATE INDEX login_failures_ip ON login_failures (ip, at);
