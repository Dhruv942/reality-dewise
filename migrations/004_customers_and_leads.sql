-- Up Migration
CREATE TYPE lead_status AS ENUM ('NEW', 'CONTACTED', 'SITE_VISIT', 'NEGOTIATION', 'WON', 'LOST');

CREATE TABLE customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(btrim(name)) > 0),
  -- Normalised E.164-style (e.g. +919876543210). The dedup key: one customer per mobile number.
  mobile     text        NOT NULL,
  email      text        CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_mobile_key UNIQUE (mobile)
);
CREATE INDEX customers_email_idx ON customers (email);

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE leads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          uuid        NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  -- The property the customer is asking about.
  property_id          uuid        NOT NULL REFERENCES properties (id) ON DELETE RESTRICT,
  -- Copied from the property so it stays with the lead; used for external-id de-duplication.
  source               property_source NOT NULL,
  assigned_executive_id uuid       REFERENCES users (id) ON DELETE RESTRICT,
  status               lead_status NOT NULL DEFAULT 'NEW',
  message              text,
  -- Id of the enquiry at the external portal (set by the future webhook). Makes retries idempotent.
  external_lead_id     text,
  raw_payload          jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_source_external_lead_id_key UNIQUE (source, external_lead_id)
);
CREATE INDEX leads_customer_id_idx ON leads (customer_id);
CREATE INDEX leads_property_id_idx ON leads (property_id);
CREATE INDEX leads_assigned_executive_idx ON leads (assigned_executive_id, status);
CREATE INDEX leads_created_at_idx ON leads (created_at DESC);

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The link the assignment history was waiting for.
ALTER TABLE property_assignment_history
  ADD CONSTRAINT property_assignment_history_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE RESTRICT;

-- Down Migration
ALTER TABLE property_assignment_history DROP CONSTRAINT property_assignment_history_lead_id_fkey;
DROP TABLE leads;
DROP TABLE customers;
DROP TYPE lead_status;
