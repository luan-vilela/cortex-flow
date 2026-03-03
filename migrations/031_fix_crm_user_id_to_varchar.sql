-- Migration 031: Fix crm_user_id type from INTEGER to VARCHAR
-- Cortex Control uses UUID for user IDs, so crm_user_id must support that

ALTER TABLE users
  ALTER COLUMN crm_user_id TYPE VARCHAR(255) USING crm_user_id::VARCHAR;

-- Add index for faster SSO lookups
CREATE INDEX IF NOT EXISTS idx_users_crm_user_id ON users(crm_user_id) WHERE crm_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_crm_source ON users(crm_source) WHERE crm_source IS NOT NULL;
