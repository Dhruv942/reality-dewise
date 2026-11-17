
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS external_created_at timestamptz;

-- Down Migration
ALTER TABLE leads DROP COLUMN IF EXISTS external_created_at;
