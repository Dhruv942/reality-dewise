-- Up Migration
-- New lead statuses: INCOMING, RINGING, CONNECTED, CLOSED, LOST, BROKER (plus the system PENDING_ASSIGNMENT).
-- Existing leads are mapped: NEW -> INCOMING, CONTACTED/SITE_VISIT/NEGOTIATION -> CONNECTED, WON -> CLOSED, LOST stays.
ALTER TABLE leads ALTER COLUMN status DROP DEFAULT;
CREATE TYPE lead_status_new AS ENUM ('PENDING_ASSIGNMENT', 'INCOMING', 'RINGING', 'CONNECTED', 'CLOSED', 'LOST', 'BROKER');
ALTER TABLE leads ALTER COLUMN status TYPE lead_status_new USING (
  CASE status::text
    WHEN 'NEW' THEN 'INCOMING'
    WHEN 'CONTACTED' THEN 'CONNECTED'
    WHEN 'SITE_VISIT' THEN 'CONNECTED'
    WHEN 'NEGOTIATION' THEN 'CONNECTED'
    WHEN 'WON' THEN 'CLOSED'
    ELSE status::text
  END
)::lead_status_new;
DROP TYPE lead_status;
ALTER TYPE lead_status_new RENAME TO lead_status;
ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'INCOMING';

-- Down Migration
-- Best effort: the finer old statuses cannot be recovered.
ALTER TABLE leads ALTER COLUMN status DROP DEFAULT;
CREATE TYPE lead_status_old AS ENUM ('PENDING_ASSIGNMENT', 'NEW', 'CONTACTED', 'SITE_VISIT', 'NEGOTIATION', 'WON', 'LOST');
ALTER TABLE leads ALTER COLUMN status TYPE lead_status_old USING (
  CASE status::text
    WHEN 'INCOMING' THEN 'NEW'
    WHEN 'RINGING' THEN 'CONTACTED'
    WHEN 'CONNECTED' THEN 'CONTACTED'
    WHEN 'BROKER' THEN 'CONTACTED'
    WHEN 'CLOSED' THEN 'WON'
    ELSE status::text
  END
)::lead_status_old;
DROP TYPE lead_status;
ALTER TYPE lead_status_old RENAME TO lead_status;
ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'NEW';
