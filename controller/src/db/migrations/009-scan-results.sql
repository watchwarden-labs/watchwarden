-- Phase 15A: Vulnerability scan results
CREATE TABLE IF NOT EXISTS scan_results (
  id SERIAL PRIMARY KEY,
  container_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  image TEXT NOT NULL,
  critical INTEGER DEFAULT 0,
  high INTEGER DEFAULT 0,
  medium INTEGER DEFAULT 0,
  low INTEGER DEFAULT 0,
  details TEXT,
  scanned_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_results_container_id ON scan_results(container_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_scanned_at ON scan_results(scanned_at);
