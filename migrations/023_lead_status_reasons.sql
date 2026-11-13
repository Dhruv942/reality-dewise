-- Up Migration
-- INVALID is a pipeline status. Existing LOST rows may have no reason because this feature is new.
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'INVALID';

ALTER TABLE leads
  ADD COLUMN status_reason varchar(64),
  ADD COLUMN status_reason_other varchar(20),
  ADD CONSTRAINT leads_status_reason_check CHECK (
    (status_reason IS NULL AND status_reason_other IS NULL)
    OR (
      status::text = 'INVALID'
      AND status_reason IN ('NO_REQUIREMENT', 'NOT_ABLE_TO_CONNECT', 'OUT_OF_SERVICE_AREA', 'OTHER')
      AND ((status_reason = 'OTHER' AND status_reason_other IS NOT NULL) OR (status_reason <> 'OTHER' AND status_reason_other IS NULL))
    )
    OR (
      status::text = 'LOST'
      AND status_reason IN ('BUDGET_ISSUE', 'NOT_RESPONDING_PREVIOUSLY_CONNECTED', 'BOOKED_OTHER_CHANNEL', 'CHANGED_OR_DIFFERED_PLAN', 'OTHER')
      AND ((status_reason = 'OTHER' AND status_reason_other IS NOT NULL) OR (status_reason <> 'OTHER' AND status_reason_other IS NULL))
    )
  );
CREATE INDEX leads_status_reason_idx ON leads (status, status_reason);

-- Down Migration
DROP INDEX leads_status_reason_idx;
ALTER TABLE leads DROP CONSTRAINT leads_status_reason_check, DROP COLUMN status_reason, DROP COLUMN status_reason_other;
-- PostgreSQL enum value INVALID is intentionally retained; removing enum values is unsafe.
