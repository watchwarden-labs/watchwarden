-- Phase 17D: Docker version info per agent

ALTER TABLE agents ADD COLUMN IF NOT EXISTS docker_version TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS docker_api_version TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS os TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS arch TEXT;
