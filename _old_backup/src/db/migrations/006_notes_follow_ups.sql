-- Up Migration
CREATE TABLE lead_notes (
  id         bigserial PRIMARY KEY,
  lead_id    bigint NOT NULL REFERENCES leads (id),
  author_id  bigint REFERENCES users (id),
  note       text NOT NULL CHECK (length(btrim(note)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_notes_lead_id_idx ON lead_notes (lead_id, created_at);

CREATE TABLE follow_ups (
  id               bigserial PRIMARY KEY,
  lead_id          bigint NOT NULL REFERENCES leads (id),
  assigned_to      bigint REFERENCES users (id),
  scheduled_at     timestamptz NOT NULL,
  status           follow_up_status NOT NULL DEFAULT 'PENDING',
  notes            text,
  completed_at     timestamptz,
  reminder_sent_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX follow_ups_lead_id_idx ON follow_ups (lead_id);
CREATE INDEX follow_ups_scheduled_at_idx ON follow_ups (scheduled_at);
CREATE INDEX follow_ups_pending_idx ON follow_ups (scheduled_at) WHERE status = 'PENDING';
CREATE INDEX follow_ups_assigned_to_idx ON follow_ups (assigned_to);
CREATE TRIGGER follow_ups_updated_at BEFORE UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE follow_ups;
DROP TABLE lead_notes;
