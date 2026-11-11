-- "Opened by signer" is recorded once per link: the first time each issued link is opened.
ALTER TABLE files ADD COLUMN link_opened_at TEXT;  -- when the current link (token_hash) was first opened; reset by a reissue
UPDATE files SET link_opened_at = viewed_at WHERE viewed_at IS NOT NULL;  -- links already opened don't count again after deploy
ALTER TABLE signing_links ADD COLUMN opened_at TEXT;  -- when this reminder link was first opened
