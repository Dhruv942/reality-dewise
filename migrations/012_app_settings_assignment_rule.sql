-- Up Migration
-- Admin-editable system settings (key/value). First setting: the lead assignment rule.
CREATE TABLE app_settings (
  key           text        PRIMARY KEY,
  value         text        NOT NULL,
  updated_by_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- The set of valid rules lives here too, so a bad value can never be stored.
  -- Adding a new rule later = add it here (new migration) and register its strategy in code.
  CONSTRAINT app_settings_assignment_rule_check CHECK (key <> 'assignment_rule' OR value IN ('ROUND_ROBIN'))
);
-- Round robin is the default rule.
INSERT INTO app_settings (key, value) VALUES ('assignment_rule', 'ROUND_ROBIN');

-- Down Migration
DROP TABLE app_settings;
