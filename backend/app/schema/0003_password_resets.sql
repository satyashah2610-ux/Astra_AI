-- Forgot password: one-time reset links (only their SHA-256 is stored) and the requests counted for abuse limits.

CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE INDEX password_resets_user ON password_resets (user_id);

CREATE TABLE password_reset_requests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ip TEXT,
    email TEXT NOT NULL,  -- lower-case, as typed (may not be an account)
    at TEXT NOT NULL
);
CREATE INDEX password_reset_requests_ip ON password_reset_requests (ip, at);
CREATE INDEX password_reset_requests_email ON password_reset_requests (email, at);
