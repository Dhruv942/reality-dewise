-- Up Migration
ALTER TABLE email_notification_logs ADD COLUMN assignment_created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX email_notification_logs_assignment_created_idx ON email_notification_logs (assignment_created_at DESC);

-- Down Migration
DROP INDEX email_notification_logs_assignment_created_idx;
ALTER TABLE email_notification_logs DROP COLUMN assignment_created_at;
