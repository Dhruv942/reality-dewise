-- Up Migration
-- Tokens issued before this moment are rejected, so a password change ends old sessions.
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;

-- Down Migration
ALTER TABLE users DROP COLUMN password_changed_at;
