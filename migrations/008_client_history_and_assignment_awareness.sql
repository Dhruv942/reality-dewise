-- Up Migration
-- Client (customers table): individual or company. Set when the client is first created.
CREATE TYPE customer_type AS ENUM ('INDIVIDUAL', 'COMPANY');
ALTER TABLE customers ADD COLUMN type customer_type NOT NULL DEFAULT 'INDIVIDUAL';

-- Human-friendly lead number ("Lead No: 8439"); existing leads are numbered automatically.
ALTER TABLE leads ADD COLUMN lead_no bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001);
ALTER TABLE leads ADD CONSTRAINT leads_lead_no_key UNIQUE (lead_no);

-- What the client wants, e.g. "3 BHK on Rent".
ALTER TABLE leads ADD COLUMN requirement text;

-- assigned_at: when the executive got the lead. seen_at: when they first opened it (NULL = still "new" for them).
ALTER TABLE leads ADD COLUMN assigned_at timestamptz;
ALTER TABLE leads ADD COLUMN seen_at timestamptz;
-- Leads that were already assigned are treated as seen so nobody is flooded with "new" badges.
UPDATE leads SET assigned_at = created_at, seen_at = now() WHERE assigned_executive_id IS NOT NULL;
CREATE INDEX leads_unseen_idx ON leads (assigned_executive_id, assigned_at DESC) WHERE seen_at IS NULL;

-- Down Migration
DROP INDEX leads_unseen_idx;
ALTER TABLE leads DROP COLUMN seen_at, DROP COLUMN assigned_at, DROP COLUMN requirement;
ALTER TABLE leads DROP CONSTRAINT leads_lead_no_key;
ALTER TABLE leads DROP COLUMN lead_no;
ALTER TABLE customers DROP COLUMN type;
DROP TYPE customer_type;
