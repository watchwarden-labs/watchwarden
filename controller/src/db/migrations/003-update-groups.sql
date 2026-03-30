-- Phase 13: Update groups and dependencies

ALTER TABLE containers ADD COLUMN IF NOT EXISTS update_group TEXT;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS update_priority INTEGER DEFAULT 100;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS depends_on TEXT; -- JSON array of container names
