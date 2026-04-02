-- API tokens for external integrations (e.g. Home Assistant)
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["full"]',
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  last_used_at BIGINT,
  revoked_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens (token_prefix);
