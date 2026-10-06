-- Up Migration
-- A lead with no executive available to take it is stored with this status until one is assigned.
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'PENDING_ASSIGNMENT';

-- A property is one thing regardless of portal: unique by normalised name. Where the same name already
-- exists more than once, keep the oldest and disambiguate the rest so the unique constraint can be added.
UPDATE properties p
SET name = p.name || ' (' || p.source || ' ' || p.external_property_id || ')'
FROM (
  SELECT id, row_number() OVER (
           PARTITION BY lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) ORDER BY created_at, id) AS rn
  FROM properties
) d
WHERE d.id = p.id AND d.rn > 1;

-- Source now lives on the lead; the pool of executives is a hand-picked list (property_executives),
-- so the property no longer carries a team or a primary executive. Dropping the columns also drops
-- their unique/check/foreign-key constraints and indexes.
ALTER TABLE properties
  DROP COLUMN primary_executive_id,
  DROP COLUMN team_id,
  DROP COLUMN source,
  DROP COLUMN external_property_id;
ALTER TABLE users DROP CONSTRAINT users_id_team_id_key;

ALTER TABLE properties
  ADD COLUMN name_key text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
  -- true for a property created automatically from a lead's property name
  ADD COLUMN is_stub boolean NOT NULL DEFAULT false;
ALTER TABLE properties ADD CONSTRAINT properties_name_key_key UNIQUE (name_key);

CREATE TABLE property_executives (
  property_id  uuid        NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  executive_id uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, executive_id)
);
CREATE INDEX property_executives_executive_idx ON property_executives (executive_id);

-- Round-robin pointer, one row per property (locked FOR UPDATE during assignment).
CREATE TABLE property_assignment_state (
  property_id                uuid PRIMARY KEY REFERENCES properties (id) ON DELETE CASCADE,
  last_assigned_executive_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
DROP TABLE team_assignment_state;

ALTER TABLE property_assignment_history
  DROP COLUMN team_id,
  DROP COLUMN assignment_type,
  DROP COLUMN reason;
DROP TYPE assignment_type;
DROP TYPE assignment_reason;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Migration 007 drops columns and data and cannot be reversed'; END $$;
