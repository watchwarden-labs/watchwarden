-- Phase 2: Notification templates and link templates
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS template TEXT;
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS link_template TEXT;
