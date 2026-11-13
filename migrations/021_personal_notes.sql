-- Up Migration
-- Private notepad per user. Notes are never shared: every query is scoped to users.id, including for admins.
CREATE TABLE personal_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
  content    text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personal_notes_user_idx ON personal_notes (user_id);
CREATE INDEX personal_notes_user_updated_idx ON personal_notes (user_id, updated_at DESC, id DESC);

CREATE TRIGGER personal_notes_set_updated_at
  BEFORE UPDATE ON personal_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE personal_notes;
