-- Up Migration
CREATE TYPE lead_status AS ENUM ('NEW','ASSIGNED','CONTACTED','FOLLOW_UP','CLOSED','LOST','INVALID');
CREATE TYPE assignment_status AS ENUM ('ACTIVE','ATTENDED','SLA_EXPIRED','RELEASED');
CREATE TYPE follow_up_status AS ENUM ('PENDING','COMPLETED','MISSED','CANCELLED');
CREATE TYPE enquiry_status AS ENUM ('PENDING','CONVERTED','CANCELLED');
CREATE TYPE project_status AS ENUM ('UPCOMING','ONGOING','COMPLETED','INACTIVE');
CREATE TYPE availability_status AS ENUM ('AVAILABLE','BLOCKED','SOLD');
CREATE TYPE notification_type AS ENUM ('LEAD_ASSIGNED','LEAD_REASSIGNED','FOLLOW_UP_DUE','SLA_APPROACHING','SLA_EXPIRED');
CREATE TYPE notification_status AS ENUM ('PENDING','SENT','FAILED');

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
DROP FUNCTION set_updated_at();
DROP TYPE notification_status, notification_type, availability_status, project_status,
          enquiry_status, follow_up_status, assignment_status, lead_status;
