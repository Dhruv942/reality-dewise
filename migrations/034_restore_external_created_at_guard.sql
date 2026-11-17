-- Up Migration
-- Safe compatibility guard for databases where the historical 024 down migration was applied
-- without the matching application migration record being repaired.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_created_at timestamptz;

-- Down Migration
-- Intentionally retained: this compatibility column is required by current lead/webhook code.
