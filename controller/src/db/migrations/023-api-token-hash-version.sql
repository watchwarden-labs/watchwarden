-- Track the hashing algorithm version for API tokens.
-- version 0 = legacy (sha-256 / hmac-sha-256, issued before v0.3.17)
-- version 1 = PBKDF2-sha256 with per-deployment salt (current)
--
-- All existing rows default to 0 (legacy). They will be rejected at auth
-- time with a clear message asking the user to revoke and re-issue the token.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS hash_version INTEGER NOT NULL DEFAULT 0;
