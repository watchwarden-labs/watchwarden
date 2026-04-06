-- Flag stateful containers (databases, caches) to protect from bulk updates
ALTER TABLE containers ADD COLUMN IF NOT EXISTS is_stateful BOOLEAN DEFAULT FALSE;
