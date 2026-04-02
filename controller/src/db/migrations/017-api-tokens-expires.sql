-- Add expires_at column to api_tokens (missed in initial migration)
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at BIGINT;
