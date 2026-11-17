-- Up Migration
-- Reporting uses the existing source-of-truth tables; these indexes support common filter predicates.
CREATE INDEX leads_reports_source_status_created_idx ON leads (source, status, created_at DESC);
CREATE INDEX leads_reports_assignee_created_idx ON leads (assigned_executive_id, created_at DESC);
CREATE INDEX leads_reports_followup_created_idx ON leads (follow_up_at, created_at DESC) WHERE follow_up_at IS NOT NULL;
CREATE INDEX assignment_history_reports_created_idx ON property_assignment_history (created_at DESC, method, executive_id);

-- Down Migration
DROP INDEX assignment_history_reports_created_idx;
DROP INDEX leads_reports_followup_created_idx;
DROP INDEX leads_reports_assignee_created_idx;
DROP INDEX leads_reports_source_status_created_idx;
