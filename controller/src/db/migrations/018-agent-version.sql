-- Track agent software version reported during REGISTER
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_version TEXT;
