-- Up Migration
ALTER TYPE lead_activity_type ADD VALUE IF NOT EXISTS 'COMMENT_ADDED';

-- Down Migration
-- PostgreSQL enum values are intentionally retained; removing them is unsafe for existing history rows.
