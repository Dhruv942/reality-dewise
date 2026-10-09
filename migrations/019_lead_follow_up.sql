-- Up Migration
-- The next follow-up of a lead: when, why, and who last changed it. All nullable; NULL follow_up_at = nothing scheduled.
-- Timestamps are timestamptz (UTC); the API returns ISO-8601 and the client shows them in its own timezone.
ALTER TABLE leads
  ADD COLUMN follow_up_at         timestamptz,
  ADD COLUMN follow_up_note       text,
  ADD COLUMN follow_up_updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN follow_up_updated_at timestamptz;
CREATE INDEX leads_follow_up_at_idx ON leads (follow_up_at) WHERE follow_up_at IS NOT NULL;

-- Down Migration
DROP INDEX leads_follow_up_at_idx;
ALTER TABLE leads
  DROP COLUMN follow_up_updated_at,
  DROP COLUMN follow_up_updated_by,
  DROP COLUMN follow_up_note,
  DROP COLUMN follow_up_at;
