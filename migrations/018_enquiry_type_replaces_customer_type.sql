-- Up Migration
-- Each enquiry says whether the client wants to RENT or BUY (optional: older leads and portals that do not
-- send it stay NULL). This replaces the Individual/Company client type, which is removed.
CREATE TYPE enquiry_type AS ENUM ('RENT', 'BUY');
ALTER TABLE leads ADD COLUMN enquiry_type enquiry_type;

ALTER TABLE customers DROP COLUMN type;
DROP TYPE customer_type;

-- Down Migration
CREATE TYPE customer_type AS ENUM ('INDIVIDUAL', 'COMPANY');
ALTER TABLE customers ADD COLUMN type customer_type NOT NULL DEFAULT 'INDIVIDUAL';
ALTER TABLE leads DROP COLUMN enquiry_type;
DROP TYPE enquiry_type;
