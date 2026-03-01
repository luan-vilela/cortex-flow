-- Adiciona colunas de tokens OAuth2 à tabela gmail_credentials
-- Necessário para refresh de tokens sem dependência do n8n
ALTER TABLE gmail_credentials
ADD COLUMN IF NOT EXISTS access_token TEXT,
ADD COLUMN IF NOT EXISTS refresh_token TEXT,
ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;