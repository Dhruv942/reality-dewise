-- Up Migration
-- A lead that stays INCOMING for the configured time after it was assigned is reassigned to the next eligible
-- executive. TIMEOUT marks those reassignments in the assignment history (next to ROUND_ROBIN and MANUAL).
ALTER TYPE assignment_method ADD VALUE IF NOT EXISTS 'TIMEOUT';

-- Admin-configurable timeout, in minutes. 60 (one hour) is the default. The CHECK keeps stored values sane
-- (1 minute to 7 days); CASE guarantees the cast only runs on digits.
ALTER TABLE app_settings ADD CONSTRAINT app_settings_lead_timeout_check CHECK (
  key <> 'lead_timeout_minutes'
  OR CASE WHEN value ~ '^[0-9]{1,5}$' THEN value::int BETWEEN 1 AND 10080 ELSE false END
);
INSERT INTO app_settings (key, value) VALUES ('lead_timeout_minutes', '60') ON CONFLICT (key) DO NOTHING;

-- The periodic sweep looks for assigned leads that are still INCOMING and old enough.
CREATE INDEX leads_timeout_idx ON leads (assigned_at) WHERE status = 'INCOMING' AND assigned_executive_id IS NOT NULL;

-- Down Migration
DROP INDEX leads_timeout_idx;
DELETE FROM app_settings WHERE key = 'lead_timeout_minutes';
ALTER TABLE app_settings DROP CONSTRAINT app_settings_lead_timeout_check;
-- The TIMEOUT value of assignment_method cannot be removed from the enum; it is simply unused after reverting.
