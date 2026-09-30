-- Up Migration
CREATE TABLE leads (
  id             bigserial PRIMARY KEY,
  customer_id    bigint NOT NULL REFERENCES customers (id),
  project_id     bigint NOT NULL REFERENCES projects (id),
  property_id    bigint REFERENCES properties (id),
  enquiry_id     bigint UNIQUE REFERENCES enquiries (id), -- one enquiry converts to at most one lead
  source         text NOT NULL,                            -- '99acres', 'magicbricks', 'direct', ...
  external_id    text,                                     -- portal's own lead id, makes retries idempotent
  requirement    text,
  budget         numeric(14,2) CHECK (budget >= 0),
  status         lead_status NOT NULL DEFAULT 'NEW',
  assigned_to    bigint REFERENCES users (id),             -- current owner (denormalized from lead_assignments)
  assigned_at    timestamptz,
  sla_deadline   timestamptz,                              -- deadline of the current assignment
  contacted_at   timestamptz,                              -- first time an executive attended the lead
  reassign_count integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX leads_customer_id_idx ON leads (customer_id);
CREATE INDEX leads_project_id_idx ON leads (project_id);
CREATE INDEX leads_assigned_to_idx ON leads (assigned_to);
CREATE INDEX leads_status_idx ON leads (status);
CREATE INDEX leads_created_at_idx ON leads (created_at);
CREATE INDEX leads_sla_deadline_idx ON leads (sla_deadline) WHERE status = 'ASSIGNED' AND contacted_at IS NULL;
CREATE UNIQUE INDEX leads_source_external_uq ON leads (source, external_id) WHERE external_id IS NOT NULL;

-- One row per assignment attempt; never overwritten.
CREATE TABLE lead_assignments (
  id                  bigserial PRIMARY KEY,
  lead_id             bigint NOT NULL REFERENCES leads (id),
  user_id             bigint NOT NULL REFERENCES users (id),
  team_id             bigint NOT NULL REFERENCES teams (id),
  status              assignment_status NOT NULL DEFAULT 'ACTIVE',
  reason              text NOT NULL,                        -- INITIAL | SLA_EXPIRED
  assigned_at         timestamptz NOT NULL,
  sla_deadline        timestamptz NOT NULL,
  sla_warning_sent_at timestamptz,
  attended_at         timestamptz,
  ended_at            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_assignments_lead_id_idx ON lead_assignments (lead_id);
CREATE INDEX lead_assignments_user_id_idx ON lead_assignments (user_id);
-- A lead can only have one "current" assignment: this is what prevents double assignment at the DB level.
CREATE UNIQUE INDEX lead_assignments_current_uq ON lead_assignments (lead_id) WHERE status IN ('ACTIVE','ATTENDED');
-- Drives the SLA job.
CREATE INDEX lead_assignments_sla_idx ON lead_assignments (sla_deadline) WHERE status = 'ACTIVE';

CREATE TABLE lead_status_history (
  id          bigserial PRIMARY KEY,
  lead_id     bigint NOT NULL REFERENCES leads (id),
  from_status lead_status,
  to_status   lead_status NOT NULL,
  changed_by  bigint REFERENCES users (id),                 -- NULL = system
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_status_history_lead_id_idx ON lead_status_history (lead_id, created_at);

CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE lead_status_history;
DROP TABLE lead_assignments;
DROP TABLE leads;
