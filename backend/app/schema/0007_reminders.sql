-- Daily reminders until a file is signed, and a "signed" email to the staff member who sent it.

ALTER TABLE files ADD COLUMN remind_at TEXT;  -- next reminder; NULL = none (not emailed, or signed)
ALTER TABLE files ADD COLUMN sent_by TEXT REFERENCES users (id) ON DELETE SET NULL;  -- who sent or last reissued it
ALTER TABLE files ADD COLUMN link_base TEXT;  -- the app address links were built with (the reminder loop has no request)
CREATE INDEX files_remind_at ON files (remind_at) WHERE remind_at IS NOT NULL;

-- Links emailed in reminders. They work alongside files.token_hash until the file is signed or its link reissued.
CREATE TABLE signing_links (
    token_hash TEXT PRIMARY KEY,  -- SHA-256 of the emailed secret
    file_id TEXT NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);
CREATE INDEX signing_links_file ON signing_links (file_id);

-- Reminders have their own daily allowance, so unsigned files can't use up the allowance for new sends.
ALTER TABLE signing_emails ADD COLUMN kind TEXT NOT NULL DEFAULT 'send' CHECK (kind IN ('send', 'reminder'));
DROP INDEX signing_emails_organization;
CREATE INDEX signing_emails_organization ON signing_emails (organization_id, kind, at);

ALTER TABLE file_events DROP CONSTRAINT file_events_type_check;
ALTER TABLE file_events ADD CONSTRAINT file_events_type_check
    CHECK (type IN ('created', 'sent', 'link_reissued', 'viewed', 'signed', 'email_sent', 'email_failed',
                    'reminder_sent', 'reminder_failed', 'signed_notice_sent', 'signed_notice_failed'));
