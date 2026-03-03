-- Cortex Flow - Database Init
-- Creates all tables for the standalone automation management system

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create n8n database if not exists (n8n needs its own db)
SELECT 'CREATE DATABASE n8n_db OWNER flow'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n_db')\gexec

-- =====================
-- USERS
-- =====================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255),
  avatar_url TEXT,
  -- SSO from Cortex Control (UUID)
  crm_user_id VARCHAR(255),
  crm_source VARCHAR(50),
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================
-- WORKSPACES
-- =====================
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Integration with Cortex Control (optional)
  crm_workspace_id INTEGER,
  crm_api_url TEXT,
  crm_api_key TEXT,
  -- n8n config
  n8n_base_url TEXT,
  n8n_api_key TEXT,
  n8n_tag_id VARCHAR(100),
  -- Settings
  settings JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================
-- WORKSPACE MEMBERS
-- =====================
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator', 'viewer')),
  invited_by UUID REFERENCES users(id),
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

-- =====================
-- FLOWS
-- =====================
CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  -- n8n reference
  n8n_workflow_id VARCHAR(100),
  n8n_tag_id VARCHAR(100),
  -- State
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
  trigger_type VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'webhook', 'cron', 'event')),
  -- Webhook trigger
  webhook_token UUID UNIQUE DEFAULT uuid_generate_v4(),
  -- Cron trigger
  cron_expression VARCHAR(100),
  -- Metadata
  tags TEXT[] NOT NULL DEFAULT '{}',
  icon VARCHAR(50),
  color VARCHAR(20),
  -- Ownership
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================
-- EXECUTIONS
-- =====================
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- n8n reference
  n8n_execution_id VARCHAR(100),
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'error', 'canceled')),
  -- Trigger info
  triggered_by VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'webhook', 'schedule', 'sso_user')),
  triggered_by_user_id UUID REFERENCES users(id),
  -- Data
  input_data JSONB NOT NULL DEFAULT '{}',
  output_data JSONB,
  error_message TEXT,
  error_details JSONB,
  -- Timing
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================
-- CREDENTIALS
-- =====================
CREATE TABLE IF NOT EXISTS credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  -- Reference to n8n credential (n8n stores the actual values encrypted)
  n8n_credential_id VARCHAR(100),
  -- Metadata only, never store actual keys here
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================
-- WEBHOOK ENDPOINTS (inbound)
-- =====================
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path_token UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  description TEXT,
  -- Security
  secret_key VARCHAR(255),
  allowed_ips TEXT[],
  -- Stats
  total_calls INTEGER NOT NULL DEFAULT 0,
  last_called_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================
-- AUDIT LOG
-- =====================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================
-- REFRESH TOKENS
-- =====================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================
-- INDEXES
-- =====================
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_flows_workspace ON flows(workspace_id);
CREATE INDEX IF NOT EXISTS idx_flows_status ON flows(status);
CREATE INDEX IF NOT EXISTS idx_flows_webhook_token ON flows(webhook_token);
CREATE INDEX IF NOT EXISTS idx_executions_flow ON executions(flow_id);
CREATE INDEX IF NOT EXISTS idx_executions_workspace ON executions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_started_at ON executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_workspace ON audit_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_token ON webhook_endpoints(path_token);
CREATE INDEX IF NOT EXISTS idx_credentials_workspace ON credentials(workspace_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
