-- Personalised signing email: the staff member's note to the signer, and the email result on the file's timeline.

ALTER TABLE files ADD COLUMN message TEXT;

ALTER TABLE file_events ADD COLUMN detail TEXT;  -- e.g. the address an email went to
ALTER TABLE file_events DROP CONSTRAINT file_events_type_check;
ALTER TABLE file_events ADD CONSTRAINT file_events_type_check
    CHECK (type IN ('created', 'sent', 'link_reissued', 'viewed', 'signed', 'email_sent', 'email_failed'));
