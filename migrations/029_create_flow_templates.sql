-- Migration 029: Tabela de templates de flows pré-configurados
-- Cada template contém uma definição n8n com placeholders {{PARAM}}
-- que são substituídos pelo backend no momento da instalação.
CREATE TABLE IF NOT EXISTS flow_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL DEFAULT 'general',
    trigger_type VARCHAR(50) NOT NULL DEFAULT 'manual',
    icon VARCHAR(50) DEFAULT '⚡',
    color VARCHAR(20) DEFAULT '#6366f1',
    -- Array de objetos descrevendo cada parâmetro necessário para instalação
    -- { key, label, type, required, default?, description? }
    parameters_schema JSONB NOT NULL DEFAULT '[]',
    -- Definição completa do workflow n8n com placeholders {{KEY}}
    n8n_definition JSONB NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT NOW (),
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT NOW ()
);

CREATE INDEX IF NOT EXISTS idx_flow_templates_active ON flow_templates (active);

CREATE INDEX IF NOT EXISTS idx_flow_templates_category ON flow_templates (category);

-- ── Seed: Template de Email Marketing por Cron ─────────────────────────────
INSERT INTO
    flow_templates (
        name,
        description,
        category,
        trigger_type,
        icon,
        color,
        parameters_schema,
        n8n_definition
    )
VALUES
    (
        'Email Marketing por Cron',
        'Envia emails personalizados para uma lista de destinatários em um horário agendado via cron. O usuário fornece uma lista JSON com {email, message} e a conta Google é usada para o envio.',
        'email',
        'cron',
        '📧',
        '#10b981',
        '[
    {
      "key": "CRON_EXPRESSION",
      "label": "Agendamento (cron)",
      "type": "cron",
      "required": true,
      "default": "0 8 * * 1-5",
      "description": "Formato: minuto hora dia mês dia-semana. Ex: 0 8 * * 1-5 = seg-sex às 08:00"
    },
    {
      "key": "EMAIL_SUBJECT",
      "label": "Assunto do email",
      "type": "string",
      "required": true,
      "default": "Mensagem personalizada para você",
      "description": "Assunto que aparecerá no email dos destinatários"
    },
    {
      "key": "RECIPIENTS_JSON",
      "label": "Lista de destinatários (JSON)",
      "type": "json",
      "required": true,
      "description": "Array de objetos com {email, message}. Ex: [{\"email\":\"a@b.com\",\"message\":\"Olá!\"}]"
    },
    {
      "key": "CREDENTIAL_ID",
      "label": "Conta Gmail (credencial n8n)",
      "type": "credential",
      "credentialType": "gmailOAuth2",
      "required": true,
      "description": "ID da credencial Gmail OAuth2 configurada no n8n. Crie em Settings → Credentials no n8n."
    }
  ]',
        '{
    "nodes": [
      {
        "id": "a1b2c3d4-e5f6-1111-aaaa-000000000001",
        "name": "Agendar Envio",
        "type": "n8n-nodes-base.scheduleTrigger",
        "typeVersion": 1.2,
        "position": [100, 300],
        "parameters": {
          "rule": {
            "interval": [
              {
                "field": "cronExpression",
                "expression": "{{CRON_EXPRESSION}}"
              }
            ]
          }
        }
      },
      {
        "id": "a1b2c3d4-e5f6-2222-bbbb-000000000002",
        "name": "Carregar Destinatarios",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [350, 300],
        "parameters": {
          "jsCode": "const list = {{RECIPIENTS_JSON}};\nreturn list.map(r => ({ json: r }));"
        }
      },
      {
        "id": "a1b2c3d4-e5f6-3333-cccc-000000000003",
        "name": "Enviar Email",
        "type": "n8n-nodes-base.gmail",
        "typeVersion": 2.1,
        "position": [600, 300],
        "parameters": {
          "sendTo": "={{ $json.email }}",
          "subject": "{{EMAIL_SUBJECT}}",
          "emailType": "text",
          "message": "={{ $json.message || \"Você recebeu uma mensagem.\" }}"
        },
        "credentials": {
          "gmailOAuth2": {
            "id": "{{CREDENTIAL_ID}}",
            "name": "Gmail Account"
          }
        }
      }
    ],
    "connections": {
      "Agendar Envio": {
        "main": [[{"node": "Carregar Destinatarios", "type": "main", "index": 0}]]
      },
      "Carregar Destinatarios": {
        "main": [[{"node": "Enviar Email", "type": "main", "index": 0}]]
      }
    },
    "settings": {
      "executionOrder": "v1"
    },
    "pinData": {}
  }'
    );