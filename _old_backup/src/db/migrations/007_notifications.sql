-- Up Migration
-- Written in the same transaction as the business change (outbox style). A future dispatcher
-- (FCM / WhatsApp / ...) reads PENDING rows and marks them SENT/FAILED.
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id),
  type       notification_type NOT NULL,
  title      text NOT NULL,
  body       text,
  lead_id    bigint REFERENCES leads (id),
  payload    jsonb NOT NULL DEFAULT '{}',
  status     notification_status NOT NULL DEFAULT 'PENDING',
  sent_at    timestamptz,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_pending_idx ON notifications (created_at) WHERE status = 'PENDING';
CREATE INDEX notifications_lead_id_idx ON notifications (lead_id);

-- Down Migration
DROP TABLE notifications;
