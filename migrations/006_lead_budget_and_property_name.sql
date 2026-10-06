-- Up Migration
-- Budget in rupees (e.g. 8000000 for "80 Lakh"); property_name is the name exactly as the portal sent it.
ALTER TABLE leads ADD COLUMN budget numeric(14, 2) CHECK (budget IS NULL OR budget >= 0);
ALTER TABLE leads ADD COLUMN property_name text;

-- Down Migration
ALTER TABLE leads DROP COLUMN property_name;
ALTER TABLE leads DROP COLUMN budget;
