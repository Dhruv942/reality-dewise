-- Up Migration
-- Projects and inventory extend the existing property model without changing lead or assignment keys.

CREATE SEQUENCE projects_code_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE SEQUENCE inventory_code_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code text NOT NULL UNIQUE,
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  description  text,
  location     text,
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_status_idx ON projects (status);
CREATE INDEX projects_name_idx ON projects (lower(name));
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE properties
  ADD COLUMN project_id uuid REFERENCES projects (id) ON DELETE RESTRICT,
  ADD COLUMN transaction_type text CHECK (transaction_type IN ('RENT_LEASE', 'SALE_PURCHASE')),
  ADD COLUMN property_type text CHECK (property_type IN ('RESIDENTIAL', 'COMMERCIAL')),
  ADD COLUMN min_price numeric(14, 2) CHECK (min_price IS NULL OR min_price >= 0),
  ADD COLUMN max_price numeric(14, 2) CHECK (max_price IS NULL OR max_price >= 0),
  ADD COLUMN currency text NOT NULL DEFAULT 'INR' CHECK (length(btrim(currency)) BETWEEN 3 AND 3),
  ADD COLUMN price_band text CHECK (price_band IS NULL OR price_band IN ('THOUSANDS', 'LAKHS', 'UP_TO_2_CR', 'ABOVE_2_TO_4_CR', 'ABOVE_4_TO_6_CR', 'ABOVE_6_TO_8_CR', 'ABOVE_8_CR', 'UNKNOWN', 'MIXED')),
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT properties_price_range_check CHECK (min_price IS NULL OR max_price IS NULL OR min_price <= max_price);
UPDATE properties SET archived_at = now() WHERE is_active = false AND archived_at IS NULL;
CREATE INDEX properties_project_id_idx ON properties (project_id);
CREATE INDEX properties_transaction_type_idx ON properties (transaction_type);
CREATE INDEX properties_property_type_idx ON properties (property_type);
CREATE INDEX properties_location_idx ON properties (lower(location));
CREATE INDEX properties_price_band_idx ON properties (price_band);

CREATE TABLE inventory (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_code   text NOT NULL UNIQUE CHECK (inventory_code ~ '^[0-9]{10}$'),
  property_id      uuid NOT NULL REFERENCES properties (id) ON DELETE RESTRICT,
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  description      text,
  location         text,
  transaction_type text CHECK (transaction_type IN ('RENT_LEASE', 'SALE_PURCHASE')),
  property_type    text CHECK (property_type IN ('RESIDENTIAL', 'COMMERCIAL')),
  min_price        numeric(14, 2) CHECK (min_price IS NULL OR min_price >= 0),
  max_price        numeric(14, 2) CHECK (max_price IS NULL OR max_price >= 0),
  currency         text NOT NULL DEFAULT 'INR' CHECK (length(btrim(currency)) BETWEEN 3 AND 3),
  price_band       text CHECK (price_band IS NULL OR price_band IN ('THOUSANDS', 'LAKHS', 'UP_TO_2_CR', 'ABOVE_2_TO_4_CR', 'ABOVE_4_TO_6_CR', 'ABOVE_6_TO_8_CR', 'ABOVE_8_CR', 'UNKNOWN', 'MIXED')),
  status           text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'EXPIRED', 'INACTIVE')),
  available_from   date,
  archived_at      timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_price_range_check CHECK (min_price IS NULL OR max_price IS NULL OR min_price <= max_price)
);
CREATE INDEX inventory_property_id_idx ON inventory (property_id);
CREATE INDEX inventory_status_idx ON inventory (status);
CREATE INDEX inventory_location_idx ON inventory (lower(location));
CREATE INDEX inventory_price_band_idx ON inventory (price_band);
CREATE INDEX inventory_created_at_idx ON inventory (created_at DESC);
CREATE TRIGGER inventory_set_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE inventory;
ALTER TABLE properties
  DROP CONSTRAINT properties_price_range_check,
  DROP COLUMN archived_at,
  DROP COLUMN price_band,
  DROP COLUMN currency,
  DROP COLUMN max_price,
  DROP COLUMN min_price,
  DROP COLUMN property_type,
  DROP COLUMN transaction_type,
  DROP COLUMN project_id;
DROP TABLE projects;
DROP SEQUENCE inventory_code_seq;
DROP SEQUENCE projects_code_seq;
