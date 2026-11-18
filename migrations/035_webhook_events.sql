-- Up Migration
-- Every portal webhook body is stored BEFORE it is validated, so a payload the mapper rejects (or a crash while
-- creating the lead) is never lost and can be inspected and replayed.
CREATE TABLE webhook_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb,
  status      text        NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'FAILED')),
  lead_id     uuid        REFERENCES leads (id) ON DELETE SET NULL,
  error       text,
  processed_at timestamptz
);
CREATE INDEX webhook_events_status_received_idx ON webhook_events (status, received_at DESC);
CREATE INDEX webhook_events_source_received_idx ON webhook_events (source, received_at DESC);

-- Down Migration
DROP TABLE IF EXISTS webhook_events;
