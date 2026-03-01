-- Gmail credentials table
-- Stores connected Gmail accounts per workspace, linked to n8n credentials
CREATE TABLE IF NOT EXISTS gmail_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    n8n_credential_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS idx_gmail_credentials_workspace ON gmail_credentials (workspace_id);