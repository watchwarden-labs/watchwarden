-- Track which container config values come from Docker labels vs UI overrides.
-- label_* columns are always overwritten by agent heartbeats (authoritative from compose/labels).
-- The existing policy/tag_pattern/update_level/update_group/update_priority/depends_on columns
-- remain as UI-set overrides and are never touched by heartbeats.
ALTER TABLE containers ADD COLUMN IF NOT EXISTS label_policy TEXT;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS label_tag_pattern TEXT;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS label_update_level TEXT;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS label_group TEXT;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS label_priority INTEGER;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS label_depends_on TEXT;
