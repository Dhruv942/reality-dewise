-- Up Migration
-- The confirmed lead SLA default is 90 minutes (was 60). Installs where nobody has ever saved the setting
-- (the value still comes from the 013 seed, updated_by_id IS NULL) move to 90. A value an admin saved is theirs
-- and is left alone, even if it happens to be 60.
UPDATE app_settings
SET value = '90', updated_at = now()
WHERE key = 'lead_timeout_minutes' AND updated_by_id IS NULL AND value = '60';

-- Fresh installs that somehow have no row get the new default as well.
INSERT INTO app_settings (key, value) VALUES ('lead_timeout_minutes', '90') ON CONFLICT (key) DO NOTHING;

-- Down Migration
UPDATE app_settings
SET value = '60', updated_at = now()
WHERE key = 'lead_timeout_minutes' AND updated_by_id IS NULL AND value = '90';
