-- Reminders stop after seven: one a day for the seven days after a link is emailed.
ALTER TABLE files ADD COLUMN reminders_left INTEGER NOT NULL DEFAULT 0;  -- set to 7 when a link is emailed; one used per reminder attempted
-- Files already being reminded get what's left of the seven for their current link: reminders attempted (delivered
-- or not) since the latest send or reissue. Any with none left stop now.
UPDATE files f SET reminders_left = GREATEST(0, 7 - (
    SELECT COUNT(*) FROM file_events e
    WHERE e.file_id = f.id AND e.type IN ('reminder_sent', 'reminder_failed')
      AND e.id > COALESCE((SELECT MAX(s.id) FROM file_events s WHERE s.file_id = f.id AND s.type IN ('sent', 'link_reissued')), 0)))
WHERE remind_at IS NOT NULL;
UPDATE files SET remind_at = NULL WHERE remind_at IS NOT NULL AND reminders_left = 0;
