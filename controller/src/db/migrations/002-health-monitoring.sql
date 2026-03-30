-- Phase 12: Health monitoring and auto-rollback

ALTER TABLE containers ADD COLUMN IF NOT EXISTS healthcheck_config TEXT;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'unknown';

ALTER TABLE update_log ADD COLUMN IF NOT EXISTS auto_rolled_back BOOLEAN DEFAULT FALSE;
ALTER TABLE update_log ADD COLUMN IF NOT EXISTS rollback_reason TEXT;

CREATE TABLE IF NOT EXISTS update_policies (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  stability_window_seconds INTEGER DEFAULT 120,
  auto_rollback_enabled BOOLEAN DEFAULT TRUE,
  max_unhealthy_seconds INTEGER DEFAULT 30,
  created_at BIGINT NOT NULL
);

-- Seed global default policy
INSERT INTO update_policies (id, scope, stability_window_seconds, auto_rollback_enabled, max_unhealthy_seconds, created_at)
VALUES ('global', 'global', 120, true, 30, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
ON CONFLICT (id) DO NOTHING;
