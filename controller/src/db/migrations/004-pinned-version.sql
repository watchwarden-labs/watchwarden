-- Pinned version detection: containers with specific version tags are locked from updates

ALTER TABLE containers ADD COLUMN IF NOT EXISTS pinned_version BOOLEAN DEFAULT FALSE;
