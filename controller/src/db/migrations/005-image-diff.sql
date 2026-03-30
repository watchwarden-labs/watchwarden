-- Phase 14: Image diff storage

ALTER TABLE containers ADD COLUMN IF NOT EXISTS last_diff TEXT; -- JSON ImageDiff
