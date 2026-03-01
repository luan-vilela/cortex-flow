# PRD — Migração n8n → Node-RED

**Versão:** 1.0.0
**Data:** 28 de fevereiro de 2026
**Status:** Aprovado para implementação

---

## 1. Contexto e Motivação

O Cortex Flow foi construído inicialmente usando o **n8n** como motor de automação. Após análise, identificou-se que o n8n exige licença Enterprise para uso em SaaS multi-tenant comercial, tornando inviável o modelo de negócio.

O **Node-RED** (Apache 2.0) resolve o problema de licença e permite o mesmo padrão de integração via Admin API REST. O objetivo do Cortex Flow — permitir automações sem que o cliente precise baixar ou instalar nada — é mantido: o Node-RED roda invisível como motor interno.

---

## 2. Objetivos

1. Substituir n8n pelo Node-RED como motor de execução de flows
2. Manter a UX do editor visual do Cortex Flow intacta (cliente nunca vê o Node-RED)
3. Suportar Gmail OAuth2 nativamente usando tokens já armazenados no banco
4. Manter suporte a triggers: webhook (HTTP) e cron (agendado)
5. Licença 100% open-source, zero custo de engine

---

## 3. Não-Objetivos

- Não expor o editor do Node-RED para clientes
- Não suportar outros tipos de nodes além de Gmail + HTTP por agora
- Não implementar instâncias separadas por workspace (fase futura — isolamento via prefixo de URL + env vars por flow é suficiente agora)

---

## 4. Arquitetura

```
Cliente (browser)
    │
    ▼
Cortex Flow Frontend (Next.js :3003)
    │  API calls + JWT
    ▼
Cortex Flow Backend (NestJS :3002)
    │
    ├── FlowsService
    │     └── NodeRedBridgeService → Admin API → Node-RED (:5679)
    │
    ├── CredentialsService (Gmail OAuth2)
    │     └── armazena access_token + refresh_token no banco
    │         injeta no env do flow Node-RED ao salvar
    │
    └── FlowCompilerService (reescrito)
          └── CortexNode[] → Node-RED Flow JSON
```

### Isolamento Multi-tenant (instância única)

- Cada flow tem um **URL de webhook único**: `/webhook/{flowToken}`
- Cada flow tem **env vars próprias** via campo `env` do tab Node-RED
- Contexto de flow Node-RED é isolado por tab (`flow.get/set`)
- Colisão de URL impossível pois `flowToken` é UUID gerado no backend

---

## 5. Compilação de Nodes

### Mapeamento Cortex → Node-RED

| Node Cortex             | Nodes Node-RED gerados                                               |
| ----------------------- | -------------------------------------------------------------------- |
| `triggerNode` (webhook) | `http in` + `http response`                                          |
| `triggerNode` (cron)    | `inject` com `crontab`                                               |
| `triggerNode` (manual)  | `inject` com `once: false`                                           |
| `emailConnectionNode`   | Injeta `GMAIL_ACCESS_TOKEN` + `GMAIL_REFRESH_TOKEN` no `env` do flow |
| `emailBodyNode`         | `function` node que monta o MIME base64url                           |
| `sendEmailNode`         | `http request` para Gmail API + `function` de handle error           |

### Formato JSON do Flow Node-RED gerado

```json
{
  "id": "cortex-{flowToken}",
  "label": "Nome do Flow",
  "disabled": false,
  "env": [
    { "name": "GMAIL_ACCESS_TOKEN", "value": "ya29...", "type": "str" },
    { "name": "GMAIL_REFRESH_TOKEN", "value": "1//...", "type": "str" },
    { "name": "GMAIL_TO", "value": "{{toEmail}}", "type": "str" },
    { "name": "GMAIL_SUBJECT", "value": "Assunto", "type": "str" },
    { "name": "GMAIL_BODY", "value": "<p>...</p>", "type": "str" }
  ],
  "nodes": [
    { "type": "http in", "url": "/webhook/{flowToken}", "method": "post", ... },
    { "type": "function", "func": "/* monta MIME email */", ... },
    { "type": "http request", "url": "https://gmail.googleapis.com/...", ... },
    { "type": "http response", ... }
  ]
}
```

---

## 6. Gmail via Node-RED

O Node-RED não suporta Gmail OAuth2 nativamente. A solução é usar **`function` node + `http request` node** com os tokens OAuth já armazenados no banco:

1. `emailConnectionNode` informa ao compilador qual `GmailCredential` usar
2. No momento do `saveNodes()`, o backend:
   - Busca a `GmailCredential` pelo ID
   - Verifica se o `access_token` está expirado → se sim, usa o `refresh_token` para renovar via `googleapis`
   - Injeta tokens no `env` do flow Node-RED
3. O `function` node no Node-RED lê os tokens via `env.get("GMAIL_ACCESS_TOKEN")` e monta a chamada à Gmail API
4. O `http request` node executa o envio

---

## 7. Mudanças no docker-compose.yml

```yaml
# REMOVER
n8n:
  image: n8nio/n8n:latest
  ...

# ADICIONAR
node-red:
  image: nodered/node-red:latest
  container_name: cortex-flow-node-red
  ports:
    - "5679:1880"
  environment:
    - NODE_RED_ENABLE_PROJECTS=false
    - NODE_OPTIONS=--max_old_space_size=512
  volumes:
    - cortex_flow_node_red_data:/data
  networks:
    - cortex-flow-network
```

---

## 8. Mudanças no Backend

### Novos arquivos

- `src/modules/node-red-bridge/node-red-bridge.service.ts`
- `src/modules/node-red-bridge/node-red-bridge.module.ts`

### Arquivos modificados

- `flow-compiler.service.ts` — reescrito para gerar JSON Node-RED
- `flows.service.ts` — trocar N8nBridgeService por NodeRedBridgeService
- `credentials.service.ts` — remover `n8nBridge.createCredential()`, adicionar `getValidAccessToken()`
- `.env` — trocar `N8N_BASE_URL` por `NODERED_BASE_URL`
- `docker-compose.yml` — trocar n8n por node-red

### Arquivos removidos (eventualmente)

- `src/modules/n8n-bridge/` — após confirmar estabilidade

---

## 9. Mudanças no Frontend

- `NodeConfigPanel.tsx` — webhook URL muda de formato
- `api.ts` — remover `getWebhookInfo()` que dependia de URL do n8n (ou adaptar)
- Remover qualquer referência a `N8N_URL` em componentes

---

## 10. Riscos e Mitigações

| Risco                                              | Mitigação                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Node-RED não tem suporte nativo Gmail OAuth2       | Usar function + http request com tokens injetados via env                      |
| Token expirado na hora de executar o flow          | Verificar expiração no `saveNodes()` e no `activate()` — renovar proativamente |
| Escalabilidade com muitos flows em instância única | Suficiente para MVP; instâncias por workspace pode ser adicionado depois       |
| Downtime durante migração                          | Manter N8nBridgeService funcional até NodeRedBridgeService estar estável       |
