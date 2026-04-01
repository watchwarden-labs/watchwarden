-- Semver update level filtering (from Docker label com.watchwarden.update_level)
ALTER TABLE containers ADD COLUMN IF NOT EXISTS update_level TEXT;
