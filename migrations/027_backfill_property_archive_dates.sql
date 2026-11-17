-- Up Migration
-- 026 backfills fresh databases; this forward-only safety migration handles databases that
-- already applied 026 before the backfill was added.
UPDATE properties SET archived_at = now() WHERE is_active = false AND archived_at IS NULL;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Migration 027 is a data backfill and is not reversible'; END $$;
