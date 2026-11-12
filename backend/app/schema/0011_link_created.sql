-- The timeline says how the link reached the client: "sent" (emailed by the app) or "link_created" (shared by staff).
ALTER TABLE file_events DROP CONSTRAINT file_events_type_check;
ALTER TABLE file_events ADD CONSTRAINT file_events_type_check
    CHECK (type IN ('created', 'sent', 'link_created', 'link_reissued', 'viewed', 'signed', 'email_sent', 'email_failed',
                    'reminder_sent', 'reminder_failed', 'signed_notice_sent', 'signed_notice_failed'));

-- Earlier sends that no email followed (before any reissue) were shared by staff: name them so.
UPDATE file_events s SET type = 'link_created'
WHERE s.type = 'sent' AND NOT EXISTS (
    SELECT 1 FROM file_events e
    WHERE e.file_id = s.file_id AND e.type IN ('email_sent', 'email_failed') AND e.id > s.id
      AND NOT EXISTS (SELECT 1 FROM file_events r WHERE r.file_id = s.file_id AND r.type = 'link_reissued' AND r.id > s.id AND r.id < e.id));
