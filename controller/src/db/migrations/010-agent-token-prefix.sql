-- Add token_prefix column for O(1) agent auth candidate filtering.
-- Stores the first 8 characters of the raw token for fast lookup
-- before bcrypt comparison, reducing O(n) scan to O(1) in practice.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS token_prefix TEXT;
CREATE INDEX IF NOT EXISTS idx_agents_token_prefix ON agents(token_prefix);
