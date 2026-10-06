-- Up Migration
-- Three roles: ADMIN, MANAGER, SALES (the former EXECUTIVE). Sales Executive and Executive Manager are the same
-- role (SALES) with a different designation, so they share every permission.

-- A check constraint that names the old enum value must go before the column type can change.
ALTER TABLE users DROP CONSTRAINT users_team_only_executives_check;

CREATE TYPE user_role_new AS ENUM ('ADMIN', 'MANAGER', 'SALES');
ALTER TABLE users ALTER COLUMN role TYPE user_role_new USING (
  CASE role::text WHEN 'EXECUTIVE' THEN 'SALES' ELSE role::text END
)::user_role_new;
DROP TYPE user_role;
ALTER TYPE user_role_new RENAME TO user_role;

CREATE TYPE user_designation AS ENUM ('MANAGER', 'SALES_EXECUTIVE', 'EXECUTIVE_MANAGER');
ALTER TABLE users ADD COLUMN designation user_designation;
UPDATE users SET designation = 'SALES_EXECUTIVE' WHERE role = 'SALES';
ALTER TABLE users ADD CONSTRAINT users_designation_matches_role_check CHECK (
  (role = 'ADMIN' AND designation IS NULL)
  OR (role = 'MANAGER' AND designation = 'MANAGER')
  OR (role = 'SALES' AND designation IN ('SALES_EXECUTIVE', 'EXECUTIVE_MANAGER'))
);
-- Only sales users belong to a team (as members).
ALTER TABLE users ADD CONSTRAINT users_team_only_executives_check CHECK (team_id IS NULL OR role = 'SALES');

-- A team is run by a manager; a manager can lead several teams. A manager may assign leads to the sales users
-- of the teams they manage.
ALTER TABLE teams ADD COLUMN manager_id uuid REFERENCES users (id) ON DELETE RESTRICT;
CREATE INDEX teams_manager_id_idx ON teams (manager_id);

-- Assignment history now also records manual assignments (admin/manager) next to round-robin ones.
-- The "one assignment per lead" uniqueness (idempotent retries) applies to round-robin rows only.
CREATE TYPE assignment_method AS ENUM ('ROUND_ROBIN', 'MANUAL');
ALTER TABLE property_assignment_history
  ADD COLUMN method assignment_method NOT NULL DEFAULT 'ROUND_ROBIN',
  ADD COLUMN assigned_by_id uuid REFERENCES users (id) ON DELETE RESTRICT; -- NULL = the system (round-robin)
DROP INDEX property_assignment_history_lead_id_key;
CREATE UNIQUE INDEX property_assignment_history_lead_id_key
  ON property_assignment_history (lead_id) WHERE lead_id IS NOT NULL AND method = 'ROUND_ROBIN';
CREATE INDEX property_assignment_history_lead_idx ON property_assignment_history (lead_id);

-- Down Migration
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'MANAGER') OR EXISTS (SELECT 1 FROM property_assignment_history WHERE method = 'MANUAL') THEN
    RAISE EXCEPTION 'Cannot revert 010: managers or manual assignments exist';
  END IF;
END $$;
DROP INDEX property_assignment_history_lead_idx;
DROP INDEX property_assignment_history_lead_id_key;
CREATE UNIQUE INDEX property_assignment_history_lead_id_key ON property_assignment_history (lead_id) WHERE lead_id IS NOT NULL;
ALTER TABLE property_assignment_history DROP COLUMN assigned_by_id, DROP COLUMN method;
DROP TYPE assignment_method;
DROP INDEX teams_manager_id_idx;
ALTER TABLE teams DROP COLUMN manager_id;
ALTER TABLE users DROP CONSTRAINT users_team_only_executives_check;
ALTER TABLE users DROP CONSTRAINT users_designation_matches_role_check;
ALTER TABLE users DROP COLUMN designation;
DROP TYPE user_designation;
CREATE TYPE user_role_old AS ENUM ('ADMIN', 'EXECUTIVE');
ALTER TABLE users ALTER COLUMN role TYPE user_role_old USING (CASE role::text WHEN 'SALES' THEN 'EXECUTIVE' ELSE role::text END)::user_role_old;
DROP TYPE user_role;
ALTER TYPE user_role_old RENAME TO user_role;
ALTER TABLE users ADD CONSTRAINT users_team_only_executives_check CHECK (team_id IS NULL OR role = 'EXECUTIVE');
