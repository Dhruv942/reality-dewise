-- Up Migration
-- Extensible: add sources later with `ALTER TYPE property_source ADD VALUE 'HOUSING';`
CREATE TYPE property_source AS ENUM ('99ACRES', 'MAGICBRICKS');
CREATE TYPE assignment_type AS ENUM ('PRIMARY', 'ROUND_ROBIN');
CREATE TYPE assignment_reason AS ENUM (
  'PRIMARY_EXECUTIVE_AVAILABLE',
  'PRIMARY_EXECUTIVE_UNAVAILABLE',
  'NO_PRIMARY_EXECUTIVE'
);

-- Target for the composite FK below (id is already unique; this adds (id, team_id)).
ALTER TABLE users ADD CONSTRAINT users_id_team_id_key UNIQUE (id, team_id);

CREATE TABLE properties (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_property_id text            NOT NULL CHECK (length(btrim(external_property_id)) > 0),
  source               property_source NOT NULL,
  name                 text            NOT NULL CHECK (length(btrim(name)) > 0),
  description          text,
  location             text,
  is_active            boolean         NOT NULL DEFAULT true,
  team_id              uuid            REFERENCES teams (id) ON DELETE RESTRICT,
  primary_executive_id uuid            REFERENCES users (id) ON DELETE RESTRICT,
  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now(),
  -- The same external id from two different portals is two different properties.
  CONSTRAINT properties_source_external_property_id_key UNIQUE (source, external_property_id),
  -- A primary executive only makes sense inside a team...
  CONSTRAINT properties_primary_requires_team_check CHECK (primary_executive_id IS NULL OR team_id IS NOT NULL),
  -- ...and must belong to *that* team. Enforced by the database, not just the service.
  CONSTRAINT properties_primary_in_team_fkey FOREIGN KEY (primary_executive_id, team_id)
    REFERENCES users (id, team_id)
);
CREATE INDEX properties_team_id_idx ON properties (team_id);
CREATE INDEX properties_primary_executive_id_idx ON properties (primary_executive_id);
CREATE INDEX properties_is_active_idx ON properties (is_active);

CREATE TRIGGER properties_set_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Persistent round-robin pointer, one row per team (locked FOR UPDATE during assignment).
CREATE TABLE team_assignment_state (
  team_id                   uuid PRIMARY KEY REFERENCES teams (id) ON DELETE RESTRICT,
  last_assigned_executive_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE property_assignment_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid              NOT NULL REFERENCES properties (id) ON DELETE RESTRICT,
  team_id         uuid              NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  executive_id    uuid              NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  assignment_type assignment_type   NOT NULL,
  reason          assignment_reason NOT NULL,
  -- No leads table yet. The Lead module adds: FOREIGN KEY (lead_id) REFERENCES leads (id).
  lead_id         uuid,
  created_at      timestamptz       NOT NULL DEFAULT now()
);
-- One assignment per lead: makes webhook retries idempotent.
CREATE UNIQUE INDEX property_assignment_history_lead_id_key
  ON property_assignment_history (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX property_assignment_history_property_idx ON property_assignment_history (property_id, created_at DESC);
CREATE INDEX property_assignment_history_executive_idx ON property_assignment_history (executive_id);

-- Down Migration
DROP TABLE property_assignment_history;
DROP TABLE team_assignment_state;
DROP TABLE properties;
ALTER TABLE users DROP CONSTRAINT users_id_team_id_key;
DROP TYPE assignment_reason;
DROP TYPE assignment_type;
DROP TYPE property_source;
