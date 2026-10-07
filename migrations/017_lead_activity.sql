-- Up Migration
-- The Activity Timeline of a lead: one persisted row per thing that happened (received, assigned, SLA started,
-- status changed, SLA breached, auto-reassigned). The portal reads these over REST (lead detail) and gets each new
-- row live as "lead:activity-created", so a refresh always shows the same timeline.
CREATE TYPE lead_activity_type AS ENUM (
  'LEAD_RECEIVED', 'ASSIGNED', 'SLA_STARTED', 'STATUS_CHANGED', 'SLA_BREACHED', 'AUTO_REASSIGNED'
);

CREATE TABLE lead_activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Rows written in one transaction share a timestamp, so order by this.
  seq          bigserial          NOT NULL,
  lead_id      uuid               NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  type         lead_activity_type NOT NULL,
  message      text               NOT NULL,
  actor_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  executive_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz        NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lead_activities_lead_idx ON lead_activities (lead_id, seq);

-- Down Migration
DROP TABLE lead_activities;
DROP TYPE lead_activity_type;
