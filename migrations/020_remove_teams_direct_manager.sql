-- Up Migration
-- Teams are gone. A sales user (role SALES) now points straight at the manager who looks after them
-- (users.manager_id); that replaces the old path executive -> team -> team.manager_id.

ALTER TABLE users ADD COLUMN manager_id uuid REFERENCES users (id) ON DELETE RESTRICT;
-- Only sales users have a manager. (That the target is a MANAGER is checked by the service: a CHECK cannot see other rows.)
ALTER TABLE users ADD CONSTRAINT users_manager_only_for_sales_check CHECK (manager_id IS NULL OR role = 'SALES');
CREATE INDEX users_manager_id_idx ON users (manager_id);

-- Carry every existing relationship over before anything is dropped. A team has at most one manager, so this is lossless.
UPDATE users u
   SET manager_id = t.manager_id
  FROM teams t
 WHERE t.id = u.team_id AND t.manager_id IS NOT NULL AND u.role = 'SALES';

-- Keep what the team tables held (names, descriptions, who was in which team) so nothing is lost and a
-- rollback can rebuild them. Nothing in the application reads these two tables; drop them once you no
-- longer need the history.
CREATE TABLE legacy_teams AS SELECT * FROM teams;
CREATE TABLE legacy_team_members AS SELECT id AS user_id, team_id FROM users WHERE team_id IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT users_team_only_executives_check;
ALTER TABLE users DROP CONSTRAINT users_team_id_fkey;
DROP INDEX users_team_id_idx;
ALTER TABLE users DROP COLUMN team_id;
DROP TABLE teams; -- also removes its indexes and updated_at trigger

-- Down Migration
CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  manager_id  uuid REFERENCES users (id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX teams_name_lower_key ON teams (lower(name));
CREATE INDEX teams_is_active_idx ON teams (is_active);
CREATE INDEX teams_manager_id_idx ON teams (manager_id);
CREATE TRIGGER teams_set_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO teams (id, name, description, is_active, created_at, updated_at, manager_id)
SELECT id, name, description, is_active, created_at, updated_at, manager_id FROM legacy_teams;

ALTER TABLE users ADD COLUMN team_id uuid;
UPDATE users u SET team_id = m.team_id FROM legacy_team_members m WHERE m.user_id = u.id;

-- Executives given a manager after the upgrade have no team: give each manager one team ("Team of <name>").
INSERT INTO teams (name, manager_id)
SELECT DISTINCT 'Team of ' || mg.name || ' (' || left(mg.id::text, 8) || ')', mg.id
  FROM users u JOIN users mg ON mg.id = u.manager_id
 WHERE u.team_id IS NULL;
UPDATE users u SET team_id = t.id
  FROM teams t
 WHERE u.team_id IS NULL AND u.manager_id IS NOT NULL AND t.manager_id = u.manager_id
   AND t.id = (SELECT min(t2.id::text)::uuid FROM teams t2 WHERE t2.manager_id = u.manager_id);

ALTER TABLE users
  ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE RESTRICT,
  ADD CONSTRAINT users_team_only_executives_check CHECK (team_id IS NULL OR role = 'SALES');
CREATE INDEX users_team_id_idx ON users (team_id);

DROP INDEX users_manager_id_idx;
ALTER TABLE users DROP CONSTRAINT users_manager_only_for_sales_check;
ALTER TABLE users DROP COLUMN manager_id;
DROP TABLE legacy_team_members;
DROP TABLE legacy_teams;
