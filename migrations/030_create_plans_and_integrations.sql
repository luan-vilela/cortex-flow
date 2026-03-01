-- Migration: Plans, WorkspaceUsage e Integrations
-- Executar: docker compose exec postgres psql -U flow -d cortex_flow -f /migrations/030_create_plans_and_integrations.sql
-- ─── Planos ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    email_limit INT NOT NULL DEFAULT 500,
    whatsapp_limit INT NOT NULL DEFAULT 0,
    ai_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    price_cents INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
);

-- Planos padrão
INSERT INTO
    plans (
        name,
        slug,
        email_limit,
        whatsapp_limit,
        ai_enabled,
        price_cents
    )
VALUES
    ('Free', 'free', 500, 0, FALSE, 0),
    ('Starter', 'starter', 5000, 0, FALSE, 2900),
    ('Pro', 'pro', 30000, 1000, TRUE, 9900),
    ('Business', 'business', 100000, 5000, TRUE, 29900) ON CONFLICT (slug) DO NOTHING;

-- ─── Uso por período ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_usage (
    id SERIAL PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    period CHAR(7) NOT NULL, -- formato 'YYYY-MM'
    emails_sent INT NOT NULL DEFAULT 0,
    whatsapp_sent INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    UNIQUE (workspace_id, period)
);

CREATE INDEX IF NOT EXISTS idx_workspace_usage_ws_period ON workspace_usage (workspace_id, period);

-- ─── Plano por workspace ────────────────────────────────────────────────────
ALTER TABLE workspaces
ADD COLUMN IF NOT EXISTS plan_id INT REFERENCES plans (id) DEFAULT 1;

-- ─── Integrações ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    template_slug VARCHAR(100) NOT NULL,
    channel VARCHAR(50) NOT NULL DEFAULT 'email', -- email | whatsapp | custom
    credential_id UUID REFERENCES gmail_credentials (id) ON DELETE SET NULL,
    default_vars JSONB NOT NULL DEFAULT '{}',
    webhook_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid (),
    node_red_flow_id VARCHAR(100) NULL, -- ID do flow no Node-RED
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | paused | draft
    created_by UUID NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
);

CREATE INDEX IF NOT EXISTS idx_integrations_workspace ON integrations (workspace_id);

CREATE INDEX IF NOT EXISTS idx_integrations_webhook_token ON integrations (webhook_token);

-- ─── Execuções em lote (bulk) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    integration_id UUID NOT NULL REFERENCES integrations (id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    total_recipients INT NOT NULL DEFAULT 0,
    accepted INT NOT NULL DEFAULT 0,
    delivered INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'processing', -- processing | done | partial
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    finished_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_bulk_executions_integration ON bulk_executions (integration_id);