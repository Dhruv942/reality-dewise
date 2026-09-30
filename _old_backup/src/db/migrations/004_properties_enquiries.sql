-- Up Migration
CREATE TABLE properties (
  id            bigserial PRIMARY KEY,
  project_id    bigint NOT NULL REFERENCES projects (id),
  unit_number   text NOT NULL,
  property_type text NOT NULL DEFAULT 'APARTMENT',
  bhk           smallint CHECK (bhk > 0),
  price         numeric(14,2) NOT NULL CHECK (price >= 0),
  area_sqft     numeric(10,2),
  availability  availability_status NOT NULL DEFAULT 'AVAILABLE',
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX properties_unit_uq ON properties (project_id, lower(unit_number)) WHERE deleted_at IS NULL;
CREATE INDEX properties_match_idx ON properties (project_id, bhk, price) WHERE availability = 'AVAILABLE' AND deleted_at IS NULL;

-- Direct enquiries (walk-in / phone). Not leads until converted. The link to the generated lead is leads.enquiry_id.
CREATE TABLE enquiries (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,
  mobile       text NOT NULL CHECK (mobile ~ '^[0-9]{10}$'),
  email        text,
  requirement  text,
  bhk          smallint CHECK (bhk > 0),
  budget       numeric(14,2) CHECK (budget >= 0),
  project_id   bigint REFERENCES projects (id),
  customer_id  bigint REFERENCES customers (id), -- set on conversion
  status       enquiry_status NOT NULL DEFAULT 'PENDING',
  notes        text,
  created_by   bigint REFERENCES users (id),
  converted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX enquiries_status_created_idx ON enquiries (status, created_at);
CREATE INDEX enquiries_mobile_idx ON enquiries (mobile);
CREATE INDEX enquiries_customer_id_idx ON enquiries (customer_id);

CREATE TRIGGER properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER enquiries_updated_at BEFORE UPDATE ON enquiries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE enquiries;
DROP TABLE properties;
