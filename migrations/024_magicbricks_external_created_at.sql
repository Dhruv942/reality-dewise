-- Up Migration
-- Vendor-reported creation time is distinct from the CRM database acceptance time.
ALTER TABLE leads ADD COLUMN external_created_at timestamptz;

-- Down Migration
ALTER TABLE leads DROP COLUMN external_created_at;
