-- Initial schema migrated from SQLite

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'offline',
  last_seen BIGINT,
  schedule_override TEXT,
  auto_update BOOLEAN DEFAULT FALSE,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  docker_id TEXT NOT NULL,
  name TEXT NOT NULL,
  image TEXT NOT NULL,
  current_digest TEXT,
  latest_digest TEXT,
  has_update BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'running',
  excluded BOOLEAN DEFAULT FALSE,
  exclude_reason TEXT,
  last_checked BIGINT,
  last_updated BIGINT
);

CREATE INDEX IF NOT EXISTS idx_containers_agent_id ON containers(agent_id);

CREATE TABLE IF NOT EXISTS update_log (
  id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  old_digest TEXT,
  new_digest TEXT,
  status TEXT NOT NULL,
  error TEXT,
  duration_ms INTEGER,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_update_log_agent_id ON update_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_update_log_status ON update_log(status);
CREATE INDEX IF NOT EXISTS idx_update_log_created_at ON update_log(created_at);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  events TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);

CREATE TABLE IF NOT EXISTS registry_credentials (
  id TEXT PRIMARY KEY,
  registry TEXT NOT NULL,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

-- Seed default config
INSERT INTO config (key, value) VALUES
  ('global_schedule', '0 4 * * *'),
  ('auto_update_global', 'false'),
  ('admin_password_hash', '')
ON CONFLICT (key) DO NOTHING;
