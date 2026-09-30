-- Up Migration
-- mobile is stored normalized (10 digits). The UNIQUE constraint is the duplicate-detection guarantee.
CREATE TABLE customers (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL,
  mobile     text NOT NULL UNIQUE CHECK (mobile ~ '^[0-9]{10}$'),
  email      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE customers;
