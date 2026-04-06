-- Flag agents that were auto-registered via recovery mode
ALTER TABLE agents ADD COLUMN IF NOT EXISTS recovery_registered BOOLEAN DEFAULT FALSE;
