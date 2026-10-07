-- Up Migration
-- In-app notifications. Created by the backend after a business event commits; the Socket.IO "notification:new"
-- event is only a live copy, so a user who missed it (offline, reconnecting) reads the same row over REST.
CREATE TYPE notification_type AS ENUM (
  'LEAD_CREATED', 'LEAD_ASSIGNED', 'LEAD_REASSIGNED', 'LEAD_STATUS_UPDATED', 'SLA_WARNING', 'SLA_EXPIRED'
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid              NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       text              NOT NULL,
  message     text              NOT NULL,
  entity_type text              NOT NULL,
  entity_id   uuid              NOT NULL,
  is_read     boolean           NOT NULL DEFAULT false,
  created_at  timestamptz       NOT NULL DEFAULT now(),
  read_at     timestamptz,
  -- Names the business event (e.g. "lead-assigned:<lead>:<executive>:<assigned_at>"). Retries, job re-runs and
  -- duplicate requests produce the same key, so the same event can never notify the same user twice.
  dedupe_key  text              NOT NULL,
  CONSTRAINT notifications_read_check CHECK ((is_read AND read_at IS NOT NULL) OR (NOT is_read AND read_at IS NULL)),
  CONSTRAINT notifications_user_dedupe_key UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC, id);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE NOT is_read;

-- Down Migration
DROP TABLE notifications;
DROP TYPE notification_type;
