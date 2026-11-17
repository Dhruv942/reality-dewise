-- Up Migration

CREATE TABLE zoho_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zoho_oauth_states_expiry_idx ON zoho_oauth_states (expires_at);

CREATE TABLE zoho_mail_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key boolean NOT NULL DEFAULT true UNIQUE,
  connected_by_admin_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  account_id text NOT NULL,
  sender_email text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  encrypted_access_token text,
  access_token_expires_at timestamptz,
  accounts_base_url text NOT NULL,
  mail_base_url text NOT NULL,
  status text NOT NULL DEFAULT 'CONNECTED' CHECK (status IN ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED')),
  notification_enabled boolean NOT NULL DEFAULT true,
  last_successful_verification_at timestamptz,
  last_error text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zoho_mail_integrations_status_idx ON zoho_mail_integrations (status);

CREATE TABLE email_notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_event_key text NOT NULL UNIQUE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE RESTRICT,
  executive_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  recipient_email text NOT NULL,
  sender_email text,
  notification_type text NOT NULL DEFAULT 'LEAD_ASSIGNED',
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  provider_message_id text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_notification_logs_queue_idx ON email_notification_logs (status, next_attempt_at, created_at);
CREATE INDEX email_notification_logs_lead_idx ON email_notification_logs (lead_id, created_at DESC);

CREATE TRIGGER zoho_mail_integrations_set_updated_at
  BEFORE UPDATE ON zoho_mail_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE email_notification_logs;
DROP TABLE zoho_mail_integrations;
DROP TABLE zoho_oauth_states;
