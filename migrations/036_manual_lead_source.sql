-- Up Migration
ALTER TYPE property_source ADD VALUE IF NOT EXISTS 'MANUAL';

ALTER TABLE leads
  ADD COLUMN manual_sub_source text;

ALTER TABLE leads
  ADD CONSTRAINT leads_manual_sub_source_check
  CHECK (manual_sub_source IS NULL OR manual_sub_source IN ('WALK_IN', 'SOCIAL_MEDIA', 'REFERRAL', 'PHONE', 'OTHER'));

ALTER TABLE leads
  ADD CONSTRAINT leads_manual_sub_source_only_check
  CHECK (source::text = 'MANUAL' OR manual_sub_source IS NULL);

CREATE INDEX leads_manual_sub_source_idx ON leads (manual_sub_source) WHERE manual_sub_source IS NOT NULL;

-- Down Migration
DROP INDEX leads_manual_sub_source_idx;
ALTER TABLE leads DROP CONSTRAINT leads_manual_sub_source_only_check;
ALTER TABLE leads DROP CONSTRAINT leads_manual_sub_source_check;
ALTER TABLE leads DROP COLUMN manual_sub_source;
-- PostgreSQL enum values are intentionally not removed in down migrations because doing so
-- would be destructive for any data written after this migration.
