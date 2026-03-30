-- Phase 17C: Blue-green update strategy
ALTER TABLE update_policies ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'stop-first';
