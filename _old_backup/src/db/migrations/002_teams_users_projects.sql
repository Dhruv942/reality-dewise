-- Up Migration
-- A team serves many projects; a project has one team (projects.team_id).
-- Round-robin state lives on the team row (last_assigned_user_id) and is updated under a row lock.
CREATE TABLE teams (
  id                    bigserial PRIMARY KEY,
  name                  text NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  last_assigned_user_id bigint,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX teams_name_uq ON teams (lower(name)) WHERE deleted_at IS NULL;

-- Executives. Auth/roles will be added later as extra columns/tables.
CREATE TABLE users (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL,
  mobile     text,
  email      text,
  is_active  boolean NOT NULL DEFAULT true,
  team_id    bigint REFERENCES teams (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX users_team_eligible_idx ON users (team_id, id) WHERE is_active AND deleted_at IS NULL;

ALTER TABLE teams
  ADD CONSTRAINT teams_last_assigned_user_fk
  FOREIGN KEY (last_assigned_user_id) REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE projects (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  location    text,
  status      project_status NOT NULL DEFAULT 'ONGOING',
  team_id     bigint REFERENCES teams (id),
  sla_minutes integer CHECK (sla_minutes > 0), -- optional per-project override of DEFAULT_LEAD_SLA_MINUTES
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX projects_name_uq ON projects (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX projects_team_id_idx ON projects (team_id);

CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE projects;
ALTER TABLE teams DROP CONSTRAINT teams_last_assigned_user_fk;
DROP TABLE users;
DROP TABLE teams;
