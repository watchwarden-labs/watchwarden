-- Cloud registry auth type support (ECR, GCR, ACR)
ALTER TABLE registry_credentials ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'basic';
