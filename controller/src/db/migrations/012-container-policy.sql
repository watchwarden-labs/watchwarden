-- Per-container update policy (from Docker label com.watchwarden.policy)
ALTER TABLE containers ADD COLUMN IF NOT EXISTS policy TEXT;
