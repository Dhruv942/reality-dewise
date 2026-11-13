-- Up Migration
ALTER TYPE assignment_method ADD VALUE IF NOT EXISTS 'TRANSFER';
ALTER TYPE lead_activity_type ADD VALUE IF NOT EXISTS 'TRANSFERRED';

ALTER TABLE property_assignment_history
  ADD COLUMN reason varchar(500);

-- Down Migration
ALTER TABLE property_assignment_history DROP COLUMN reason;
-- PostgreSQL enum values are intentionally retained; removing them is unsafe for existing history rows.
