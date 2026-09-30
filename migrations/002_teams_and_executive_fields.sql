-- Up Migration
CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive unique team name ("Team A" == "team a").
CREATE UNIQUE INDEX teams_name_lower_key ON teams (lower(name));
CREATE INDEX teams_is_active_idx ON teams (is_active);

CREATE TRIGGER teams_set_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE users
  ADD COLUMN username   text,
  ADD COLUMN team_id    uuid,
  ADD COLUMN deleted_at timestamptz;

-- Backfill usernames for pre-existing rows from the email local part (de-duplicated).
WITH base AS (
  SELECT id,
         coalesce(nullif(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g'), ''), 'user') AS b,
         created_at
  FROM users
), ranked AS (
  SELECT id, b, row_number() OVER (PARTITION BY b ORDER BY created_at, id) AS rn FROM base
)
UPDATE users u
   SET username = CASE WHEN r.rn = 1 THEN r.b ELSE r.b || r.rn END
  FROM ranked r WHERE r.id = u.id;

ALTER TABLE users
  ALTER COLUMN username SET NOT NULL,
  ADD CONSTRAINT users_username_key UNIQUE (username),
  ADD CONSTRAINT users_username_format_check CHECK (username ~ '^[a-z0-9._-]{3,50}$'),
  -- RESTRICT: teams are never hard-deleted (deactivate instead) so history keeps its team.
  ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE RESTRICT,
  -- Only executives belong to teams.
  ADD CONSTRAINT users_team_only_executives_check CHECK (team_id IS NULL OR role = 'EXECUTIVE');

CREATE INDEX users_team_id_idx   ON users (team_id);
CREATE INDEX users_role_idx      ON users (role);
CREATE INDEX users_is_active_idx ON users (is_active);

-- Down Migration
DROP INDEX users_is_active_idx;
DROP INDEX users_role_idx;
DROP INDEX users_team_id_idx;
ALTER TABLE users
  DROP CONSTRAINT users_team_only_executives_check,
  DROP CONSTRAINT users_team_id_fkey,
  DROP CONSTRAINT users_username_format_check,
  DROP CONSTRAINT users_username_key,
  DROP COLUMN deleted_at,
  DROP COLUMN team_id,
  DROP COLUMN username;
DROP TABLE teams;
