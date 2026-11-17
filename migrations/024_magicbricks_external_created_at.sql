
ALTER TABLE leads ADD COLUMN external_created_at timestamptz;
ALTER TABLE leads DROP COLUMN external_created_at;
