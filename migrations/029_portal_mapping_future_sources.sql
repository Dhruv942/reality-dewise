-- Up Migration
-- Mapping records are intentionally extensible beyond the two current lead webhook sources.
ALTER TABLE portal_property_mappings
  ALTER COLUMN portal_source TYPE text USING portal_source::text;
ALTER TABLE portal_property_mappings
  ADD CONSTRAINT portal_mapping_source_check CHECK (length(btrim(portal_source)) BETWEEN 2 AND 64);

-- Down Migration
ALTER TABLE portal_property_mappings DROP CONSTRAINT IF EXISTS portal_mapping_source_check;
ALTER TABLE portal_property_mappings ALTER COLUMN portal_source TYPE property_source USING portal_source::property_source;
