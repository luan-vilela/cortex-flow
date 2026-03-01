# PRD — Cortex Flow

**Versão:** 0.1.0  
**Data:** 28 de fevereiro de 2026  
**Status:** Em revisão

---

## 1. Visão do Produto

**Cortex Flow** é uma plataforma standalone de gerenciamento de automações, construída como camada de controle sobre o [n8n](https://n8n.io). Ele pode ser usado de forma **totalmente independente** (produto solo, como o HyperFlow ou Activepieces) ou **integrado ao Cortex Control** (ERP/CRM) para automações com acesso a dados de clientes, transações e leads.

### Posicionamento

| Modo           | Descrição                                                               |
| -------------- | ----------------------------------------------------------------------- |
| **Standalone** | Empresa compra só o Cortex Flow para criar automações, sem CRM          |
| **Integrado**  | Cortex Flow conectado ao Cortex Control, workflows acessam dados do CRM |

---

## 2. Problema

Ferramentas como n8n são poderosas mas possuem UX complexa para usuários de negócio. Empresas com múltiplas operações (workspaces) precisam:

- Isolar automações por unidade de negócio
- Controlar quem pode criar, editar e excluir flows
- Monitorar execuções e histórico por workspace
- Integrar automações com os dados do seu CRM sem expor credenciais diretamente

O n8n não oferece nativamente um modelo de multi-tenant com isolamento por workspace e controle de acesso por organização.

---

## 3. Objetivos (Goals)

1. **Multi-tenant por workspace:** cada workspace enxerga e gerencia apenas seus próprios flows
2. **Independência real:** funciona sem o Cortex Control instalado
3. **Bridge n8n transparente:** o usuário não precisa saber que existe um n8n por baixo
4. **Monitoramento de execuções:** log de tudo que rodou, quando, com qual resultado
5. **Integração opcional com CRM:** flows podem buscar e escrever dados no Cortex Control via HTTP interno
6. **SSO simples:** usuário logado no Cortex Control é redirecionado ao Flow sem novo login

---

## 4. Não-Objetivos (Out of Scope - v1)

- Editor visual de nodes (usa o editor nativo do n8n embarcado ou link direto)
- Marketplace de templates público
- Billing / cobrança por execução (fase futura)
- Suporte a múltiplos engines (ex: Zapier, Make) — v1 só n8n
- Mobile app

---

## 5. Usuários e Personas

### 5.1 Admin do Workspace

- Gerencia quais flows existem no seu workspace
- Ativa/desativa flows
- Visualiza histórico de execuções
- Configura conexões externas (API keys, OAuth)

### 5.2 Operador

- Dispara flows manualmente
- Visualiza status de execuções
- Não pode criar ou editar flows

### 5.3 Super Admin (dona da plataforma)

- Gerencia todas as instâncias de workspace
- Configura conexão com o servidor n8n
- Monitora uso de recursos / execuções por workspace

---

## 6. Arquitetura do Sistema

```
cortex-flow/             → Backend NestJS (porta 3002)
cortex-flow-front/       → Frontend Next.js (porta 3003)  ← a criar
n8n                      → Docker container (porta 5678)
PostgreSQL               → Banco próprio do Cortex Flow (porta 5436 externo)
```

### 6.1 Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────┐
│                   cortex-flow-front                      │
│              Next.js App Router (3003)                   │
└──────────────────────┬──────────────────────────────────┘
                       │ JWT Auth / SSO Token
┌──────────────────────▼──────────────────────────────────┐
│                   cortex-flow API                        │
│                  NestJS (porta 3002)                     │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Auth Module │  │ Flows Module │  │Webhooks Module │  │
│  │ (JWT + SSO) │  │(CRUD + state)│  │(callbacks n8n) │  │
│  └─────────────┘  └──────┬───────┘  └────────────────┘  │
│                          │                               │
│  ┌───────────────────────▼──────────────────────────┐   │
│  │              n8n Bridge Service                   │   │
│  │  (proxy seguro, scope por workspaceId via tags)   │   │
│  └───────────────────────┬──────────────────────────┘   │
└──────────────────────────┼──────────────────────────────┘
                           │ REST API v1
┌──────────────────────────▼──────────────────────────────┐
│                     n8n Engine                           │
│                 Docker (porta 5678)                      │
└─────────────────────────────────────────────────────────┘
                           │ HTTP Request Node (opcional)
┌──────────────────────────▼──────────────────────────────┐
│              cortex-control API (porta 3000)             │
│         Acesso opcional a: persons, transactions,        │
│         leads, finances — via API Key interna            │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Banco de Dados — Cortex Flow

```sql
-- Usuários próprios do Flow (independente do CRM)
users (id, email, password_hash, name, role, created_at)

-- Workspaces do Flow (podem ou não estar linkados ao cortex-control)
workspaces (id, name, slug, owner_id, crm_workspace_id, crm_api_url, crm_api_key, n8n_tag_id, created_at)

-- Membros por workspace
workspace_members (id, workspace_id, user_id, role[admin|operator|viewer])

-- Flows gerenciados (ponte para workflows do n8n)
flows (id, workspace_id, name, description, n8n_workflow_id, status[active|inactive|draft],
       trigger_type[webhook|cron|manual], tags[], created_by, created_at, updated_at)

-- Execuções rastreadas
executions (id, flow_id, workspace_id, n8n_execution_id, status[running|success|error|canceled],
            triggered_by[user_id|webhook|schedule], input_data JSONB, output_data JSONB,
            error_message, started_at, finished_at)

-- Credenciais seguras (metadados, n8n armazena o valor)
credentials (id, workspace_id, name, type, n8n_credential_id, created_at)

-- Webhooks de entrada registrados
webhook_endpoints (id, flow_id, workspace_id, path_token UUID, description, active, created_at)

-- Audit log
audit_log (id, workspace_id, user_id, action, entity_type, entity_id, metadata JSONB, created_at)
```

---

## 7. Funcionalidades — v1

### 7.1 Autenticação e Multi-tenant

| #       | Funcionalidade                                        | Prioridade |
| ------- | ----------------------------------------------------- | ---------- |
| AUTH-01 | Registro e login com email/senha (JWT próprio)        | Alta       |
| AUTH-02 | SSO via handshake com Cortex Control (token exchange) | Alta       |
| AUTH-03 | Roles por workspace: Admin, Operador, Viewer          | Alta       |
| AUTH-04 | Refresh token com rotação                             | Média      |
| AUTH-05 | Revogação de sessão                                   | Baixa      |

**SSO Flow:**

```
1. Usuário está logado no Cortex Control (porta 3001)
2. Clica em "Automações" → redireciona para /sso?token=<signed-jwt>
3. Cortex Flow valida assinatura com shared secret
4. Emite JWT próprio + redireciona para /dashboard
```

### 7.2 Gerenciamento de Workspaces

| #     | Funcionalidade                                     | Prioridade |
| ----- | -------------------------------------------------- | ---------- |
| WS-01 | Criar workspace no Flow                            | Alta       |
| WS-02 | Convidar membros por email                         | Média      |
| WS-03 | Linkar workspace do Flow com workspace do CRM      | Alta       |
| WS-04 | Configurar URL e API Key do CRM vinculado          | Alta       |
| WS-05 | Configurar conexão com servidor n8n (URL, API key) | Alta       |

### 7.3 Gerenciamento de Flows

| #       | Funcionalidade                                         | Prioridade |
| ------- | ------------------------------------------------------ | ---------- |
| FLOW-01 | Listar flows do workspace                              | Alta       |
| FLOW-02 | Criar flow (cria workflow no n8n com tag do workspace) | Alta       |
| FLOW-03 | Ativar / desativar flow                                | Alta       |
| FLOW-04 | Editar flow (abre editor n8n em iframe ou nova aba)    | Alta       |
| FLOW-05 | Duplicar flow                                          | Média      |
| FLOW-06 | Excluir flow (remove do n8n também)                    | Alta       |
| FLOW-07 | Importar workflow JSON do n8n                          | Média      |
| FLOW-08 | Exportar workflow JSON                                 | Média      |
| FLOW-09 | Tags e categorias de flows                             | Baixa      |
| FLOW-10 | Templates de flows pré-configurados                    | Baixa (v2) |

### 7.4 Execuções

| #       | Funcionalidade                            | Prioridade |
| ------- | ----------------------------------------- | ---------- |
| EXEC-01 | Disparar flow manualmente com payload     | Alta       |
| EXEC-02 | Listar execuções do flow (paginado)       | Alta       |
| EXEC-03 | Ver detalhes: input/output, duração, erro | Alta       |
| EXEC-04 | Cancelar execução em andamento            | Média      |
| EXEC-05 | Re-executar com mesmo payload             | Média      |
| EXEC-06 | Execuções em tempo real (polling ou SSE)  | Média      |
| EXEC-07 | Alertas de falha (email / webhook)        | Baixa      |

### 7.5 Webhooks

| #     | Funcionalidade                                                  | Prioridade |
| ----- | --------------------------------------------------------------- | ---------- |
| WH-01 | Gerar URL de webhook para trigger externo                       | Alta       |
| WH-02 | Receber callback de execução do n8n                             | Alta       |
| WH-03 | Repassar payload para o flow correto com validação de workspace | Alta       |
| WH-04 | Listar e revogar endpoints de webhook                           | Média      |

### 7.6 Credenciais

| #       | Funcionalidade                                     | Prioridade |
| ------- | -------------------------------------------------- | ---------- |
| CRED-01 | Listar credenciais cadastradas no workspace        | Média      |
| CRED-02 | Criar credencial (delega para n8n, salva metadado) | Média      |
| CRED-03 | Excluir credencial                                 | Média      |

### 7.7 Integração com Cortex Control (opcional)

| #      | Funcionalidade                                               | Prioridade |
| ------ | ------------------------------------------------------------ | ---------- |
| INT-01 | Registrar CRM vinculado ao workspace                         | Alta       |
| INT-02 | Healthcheck da conexão com o CRM                             | Média      |
| INT-03 | Expor proxy seguro: `/crm-proxy/:workspaceId/*` → CRM API    | Média      |
| INT-04 | Nodes helper para o n8n (HTTP preconfigurado aponta pro CRM) | Baixa (v2) |

---

## 8. API — Endpoints Principais

```
# Auth
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/sso/validate              ← recebe token do CRM

# Workspaces
GET    /workspaces
POST   /workspaces
GET    /workspaces/:id
PATCH  /workspaces/:id
DELETE /workspaces/:id
POST   /workspaces/:id/members
PATCH  /workspaces/:id/crm-link        ← vincula ao Cortex Control
GET    /workspaces/:id/n8n/status      ← healthcheck n8n

# Flows
GET    /workspaces/:id/flows
POST   /workspaces/:id/flows
GET    /workspaces/:id/flows/:flowId
PATCH  /workspaces/:id/flows/:flowId
DELETE /workspaces/:id/flows/:flowId
POST   /workspaces/:id/flows/:flowId/activate
POST   /workspaces/:id/flows/:flowId/deactivate
POST   /workspaces/:id/flows/:flowId/execute
POST   /workspaces/:id/flows/:flowId/duplicate
GET    /workspaces/:id/flows/:flowId/editor-url   ← URL do editor n8n

# Execuções
GET    /workspaces/:id/flows/:flowId/executions
GET    /workspaces/:id/flows/:flowId/executions/:execId
POST   /workspaces/:id/flows/:flowId/executions/:execId/cancel

# Webhooks (entrada)
POST   /webhooks/:token                ← trigger externo público
POST   /internal/n8n-callback          ← callback privado do n8n

# Credenciais
GET    /workspaces/:id/credentials
POST   /workspaces/:id/credentials
DELETE /workspaces/:id/credentials/:credId
```

---

## 9. n8n Bridge — Estratégia de Isolamento

O isolamento de workflows por workspace é feito via **tags** no n8n (solução compatível com a versão open-source).

```
Tag criada no n8n: "workspace:<uuid>"

Ao criar um flow:
1. Cortex Flow cria (ou reutiliza) a tag "workspace:<workspaceId>" no n8n
2. Cria o workflow no n8n com essa tag associada
3. Salva o n8n_workflow_id no banco do Cortex Flow

Ao listar flows:
1. Cortex Flow busca do próprio banco (não consulta o n8n para listar)
2. Usa n8n apenas para operações de estado (ativar/desativar/executar)

Segurança:
- Cortex Flow NUNCA expõe a API key do n8n para o frontend
- Toda comunicação com o n8n passa pelo Bridge Service interno
- Cada requisição ao n8n valida que o workspaceId do usuário é dono do n8n_workflow_id
```

---

## 10. SSO com Cortex Control

```
┌─────────────────┐         ┌──────────────────┐         ┌───────────────────┐
│  Cortex Control │         │  Cortex Flow API  │         │ Cortex Flow Front │
│     Frontend    │         │   (porta 3002)    │         │   (porta 3003)    │
└────────┬────────┘         └────────┬──────────┘         └─────────┬─────────┘
         │                           │                               │
         │  1. Usuário clica         │                               │
         │     "Automações"          │                               │
         │                           │                               │
         │  2. CRM Backend gera      │                               │
         │     SSO Token assinado    │                               │
         │     com SHARED_SECRET     │                               │
         │                           │                               │
         │  3. Redirect para:        │                               │
         │  /sso?token=xxx           │                               │
         │  &workspace=yyy ──────────┼───────────────────────────────►
         │                           │                               │
         │                           │  4. Flow Front chama:         │
         │                           │  POST /auth/sso/validate      │
         │                           │◄──────────────────────────────│
         │                           │                               │
         │                           │  5. Valida JWT com            │
         │                           │     SHARED_SECRET             │
         │                           │  6. Cria/atualiza user        │
         │                           │  7. Emite JWT próprio        │
         │                           │──────────────────────────────►│
         │                           │                               │
         │                           │                         8. Usuário
         │                           │                         autenticado
         │                           │                         no Flow
```

**Variáveis de ambiente necessárias (ambos os lados):**

```bash
# cortex-control .env
FLOW_URL=http://localhost:3003
FLOW_SSO_SECRET=<shared-secret-256bits>

# cortex-flow .env
CRM_SSO_SECRET=<mesmo-shared-secret>
```

---

## 11. Editor de Flows (n8n)

Para a v1, o editor de workflows é o próprio n8n, acessado de duas formas:

### Opção A — Nova aba (recomendada para v1)

- Cortex Flow gera uma URL autenticada do n8n
- Abre em nova aba diretamente no workflow
- Usuário edita, salva e volta para o Flow
- Cortex Flow detecta mudanças via webhook do n8n

### Opção B — Iframe (v2)

- n8n embedded dentro da UI do Cortex Flow
- Requer configuração de CORS e `ALLOW_IFRAME=true` no n8n
- UX mais integrada mas mais complexa de implementar

---

## 12. Stack Tecnológica

### Backend (cortex-flow/)

| Tecnologia         | Uso                          |
| ------------------ | ---------------------------- |
| NestJS 10          | Framework principal          |
| TypeORM            | ORM com PostgreSQL           |
| PostgreSQL 15      | Banco de dados               |
| JWT (passport-jwt) | Autenticação                 |
| Axios              | Chamadas HTTP para n8n e CRM |
| class-validator    | Validação de DTOs            |
| @nestjs/schedule   | Jobs de sync de execuções    |
| Swagger            | Documentação da API          |

### Frontend (cortex-flow-front/)

| Tecnologia             | Uso                                   |
| ---------------------- | ------------------------------------- |
| Next.js 15 App Router  | Framework                             |
| React Query (TanStack) | Estado servidor                       |
| Zustand                | Estado global (auth, workspace ativo) |
| React Hook Form + Zod  | Formulários                           |
| Tailwind CSS 4         | Estilização                           |
| Shadcn/ui              | Componentes base                      |
| Recharts               | Gráficos de execuções                 |

### Infraestrutura

| Serviço           | Porta                       | Container              |
| ----------------- | --------------------------- | ---------------------- |
| cortex-flow API   | 3002                        | `cortex-flow-api`      |
| PostgreSQL (Flow) | 5436 externo / 5432 interno | `cortex-flow-postgres` |
| n8n               | 5678                        | `cortex-n8n`           |

---

## 13. Docker Compose

```yaml
services:
  api:
    build: ./
    ports: ["3002:3000"]
    depends_on: [postgres, n8n]
    env_file: .env

  postgres:
    image: postgres:15
    ports: ["5436:5432"]
    environment:
      POSTGRES_DB: cortex_flow
      POSTGRES_USER: flow
      POSTGRES_PASSWORD: flow123
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql

  n8n:
    image: n8nio/n8n:latest
    ports: ["5678:5678"]
    environment:
      N8N_HOST: localhost
      N8N_PORT: 5678
      N8N_PROTOCOL: http
      N8N_BASIC_AUTH_ACTIVE: "false"
      N8N_USER_MANAGEMENT_DISABLED: "true"
      N8N_API_DISABLED: "false"
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_DATABASE: n8n
      DB_POSTGRESDB_USER: flow
      DB_POSTGRESDB_PASSWORD: flow123
    depends_on: [postgres]
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  postgres_data:
  n8n_data:
```

---

## 14. Variáveis de Ambiente

```bash
# cortex-flow/.env

# App
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://flow:flow123@postgres:5432/cortex_flow

# JWT
JWT_SECRET=cortex-flow-secret-change-in-prod
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_IN=30d

# n8n
N8N_BASE_URL=http://n8n:5678
N8N_API_KEY=<api-key-do-n8n>

# SSO com Cortex Control (opcional)
CRM_SSO_SECRET=<shared-secret-256bits>
CRM_BASE_URL=http://localhost:3000

# Frontend
FRONTEND_URL=http://localhost:3003

# Webhook público (URL pública do servidor)
PUBLIC_WEBHOOK_BASE_URL=http://localhost:3002
```

---

## 15. Modelo de Dados — Entidade Principal

### Flow

```typescript
{
  id: UUID
  workspaceId: UUID
  name: string
  description?: string
  n8nWorkflowId: string      // ID no n8n
  n8nTagId: string           // Tag do workspace no n8n
  status: 'active' | 'inactive' | 'draft'
  triggerType: 'webhook' | 'cron' | 'manual' | 'event'
  webhookToken?: UUID        // Para triggers externos
  cronExpression?: string    // Se triggerType === 'cron'
  tags: string[]
  createdBy: UUID
  createdAt: Date
  updatedAt: Date
}
```

### Execution

```typescript
{
  id: UUID
  flowId: UUID
  workspaceId: UUID
  n8nExecutionId?: string
  status: 'queued' | 'running' | 'success' | 'error' | 'canceled'
  triggeredBy: 'manual' | 'webhook' | 'schedule' | 'sso_user'
  triggeredByUserId?: UUID
  inputData: JSON
  outputData?: JSON
  errorMessage?: string
  startedAt: Date
  finishedAt?: Date
  durationMs?: number
}
```

---

## 16. Roadmap

### v1.0 — MVP (Fase atual)

- [ ] Auth completo (JWT próprio + SSO)
- [ ] CRUD de workspaces e membros
- [ ] CRUD de flows com criação/sync no n8n
- [ ] Ativar/desativar flows
- [ ] Execução manual de flows
- [ ] Listagem de execuções com status
- [ ] Webhook de entrada (trigger externo)
- [ ] Callback de resultado do n8n
- [ ] Link com Cortex Control (API Key)
- [ ] Docker Compose completo

### v1.5

- [ ] Editor n8n em iframe integrado
- [ ] Execuções em tempo real (SSE)
- [ ] Alertas de falha por email
- [ ] Templates de flows
- [ ] Gestão de credenciais via UI

### v2.0

- [ ] Marketplace de templates
- [ ] Audit log completo
- [ ] Dashboard de métricas (execuções/dia, taxa de erro)
- [ ] Multi-instância n8n (um n8n por workspace)
- [ ] SDK/CLI para publicar flows
- [ ] Billing por execução

---

## 17. Critérios de Aceitação — v1

1. **Isolamento:** usuário do workspace A nunca vê flows do workspace B
2. **Independência:** sistema funciona sem o Cortex Control configurado
3. **Bridge:** todas as chamadas ao n8n passam pela API, nunca direto do frontend
4. **SSO:** usuário logado no CRM chega no Flow sem digitar senha
5. **Rastreabilidade:** toda execução tem log persistido com input/output
6. **Segurança:** API key do n8n nunca é exposta ao cliente

---

_Cortex Flow — Automações inteligentes para times que crescem_
