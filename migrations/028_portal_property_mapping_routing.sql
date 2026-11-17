-- Up Migration
-- Portal listing identity is separate from the internal property identity.

CREATE TABLE portal_property_mappings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id             uuid NOT NULL REFERENCES properties (id) ON DELETE RESTRICT,
  portal_source           property_source NOT NULL,
  external_property_id    text,
  external_property_name  text,
  normalized_property_name text NOT NULL CHECK (length(btrim(normalized_property_name)) > 0),
  external_listing_url    text,
  is_active               boolean NOT NULL DEFAULT true,
  created_by              uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_mapping_identity_check CHECK (external_property_id IS NOT NULL OR external_property_name IS NOT NULL),
  CONSTRAINT portal_mapping_external_id_check CHECK (external_property_id IS NULL OR length(btrim(external_property_id)) > 0)
);
CREATE UNIQUE INDEX portal_mapping_active_external_id_key
  ON portal_property_mappings (portal_source, external_property_id)
  WHERE is_active AND external_property_id IS NOT NULL;
CREATE UNIQUE INDEX portal_mapping_active_alias_key
  ON portal_property_mappings (portal_source, normalized_property_name)
  WHERE is_active;
CREATE INDEX portal_mapping_property_idx ON portal_property_mappings (property_id, is_active);
CREATE INDEX portal_mapping_source_name_idx ON portal_property_mappings (portal_source, normalized_property_name);
CREATE TRIGGER portal_property_mappings_set_updated_at
  BEFORE UPDATE ON portal_property_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE leads
  ADD COLUMN external_property_id text,
  ADD COLUMN external_property_name text,
  ADD COLUMN external_property_url text,
  ADD COLUMN property_match_status text NOT NULL DEFAULT 'MATCHED'
    CHECK (property_match_status IN ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'RESOLVED', 'CONFLICT')),
  ADD COLUMN property_match_method text
    CHECK (property_match_method IS NULL OR property_match_method IN ('EXTERNAL_ID', 'PORTAL_ALIAS', 'NORMALIZED_NAME', 'FUZZY_NAME', 'MANUAL', 'UNMATCHED', 'AMBIGUOUS', 'CONFLICT')),
  ADD COLUMN property_match_confidence numeric(5, 4)
    CHECK (property_match_confidence IS NULL OR (property_match_confidence >= 0 AND property_match_confidence <= 1)),
  ADD COLUMN property_match_candidates jsonb,
  ADD COLUMN property_review_manager_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN property_resolved_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN property_resolved_at timestamptz;
CREATE INDEX leads_property_match_status_idx ON leads (property_match_status, created_at DESC);
CREATE INDEX leads_property_review_manager_idx ON leads (property_review_manager_id, property_match_status);
CREATE INDEX leads_external_property_idx ON leads (source, external_property_id);

ALTER TYPE lead_activity_type ADD VALUE IF NOT EXISTS 'PROPERTY_RESOLVED';

INSERT INTO app_settings (key, value) VALUES ('unmatched_property_routing', '{"mode":"ADMIN_QUEUE","managerId":null}')
  ON CONFLICT (key) DO NOTHING;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Migration 028 adds portal mapping and lead resolution history and is not safely reversible'; END $$;
