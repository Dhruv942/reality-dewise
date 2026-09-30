-- Up Migration
-- Free-form, non-queried attributes (property type, location, possession, ... ) captured at intake.
ALTER TABLE leads ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE enquiries ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';

-- Down Migration
ALTER TABLE enquiries DROP COLUMN metadata;
ALTER TABLE leads DROP COLUMN metadata;
