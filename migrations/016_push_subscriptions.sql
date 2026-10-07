-- Up Migration
-- Web Push: one row per browser/device a user allowed notifications on. Used to wake the app when it is closed.
CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The push service URL is the device's identity. It is a secret-ish capability: never returned by any API.
  endpoint        text        NOT NULL CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 2048),
  p256dh          text        NOT NULL,
  auth            text        NOT NULL,
  user_agent      text,
  failure_count   integer     NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id, created_at);

-- Down Migration
DROP TABLE push_subscriptions;
