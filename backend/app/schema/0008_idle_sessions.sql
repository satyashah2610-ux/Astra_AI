-- A session unused for a while ends: when each session was last used. Existing sessions count as used now,
-- so deploying this doesn't log out everyone at once.
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
UPDATE sessions SET last_seen_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"');
ALTER TABLE sessions ALTER COLUMN last_seen_at SET NOT NULL;
