-- Up Migration
-- "Important" is a per-user flag on a lead: each user marks leads for themselves and nobody else sees it.
CREATE TABLE lead_important (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lead_id    uuid        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lead_id)
);
CREATE INDEX lead_important_lead_idx ON lead_important (lead_id);

-- Down Migration
DROP TABLE lead_important;
