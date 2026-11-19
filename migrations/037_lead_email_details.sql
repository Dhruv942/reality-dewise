-- Up Migration
ALTER TYPE enquiry_type ADD VALUE IF NOT EXISTS 'PROJECT';

ALTER TABLE leads ADD COLUMN lead_type text;
ALTER TABLE leads ADD CONSTRAINT leads_lead_type_check
  CHECK (lead_type IS NULL OR lead_type IN ('INDIVIDUAL', 'BROKER_AGENT'));
CREATE INDEX leads_lead_type_idx ON leads (lead_type) WHERE lead_type IS NOT NULL;

-- Down Migration
DROP INDEX leads_lead_type_idx;
ALTER TABLE leads DROP CONSTRAINT leads_lead_type_check;
ALTER TABLE leads DROP COLUMN lead_type;
-- PostgreSQL enum values are intentionally not removed in down migrations.
