import { Injectable } from "@nestjs/common";
import {
  NodeRedFlowDefinition,
  NodeRedNode,
} from "../node-red-bridge/node-red-bridge.service";

// ── Cortex-Flow Node Types ────────────────────────────────────────────────────
export interface CortexNode {
  id: string;
  type: CortexNodeType;
  position: { x: number; y: number };
  data: Record<string, any>;
}

export type CortexNodeType =
  | "triggerNode"
  | "emailConnectionNode"
  | "emailBodyNode"
  | "sendEmailNode"
  | "webhookTriggerNode"
  | "cronTriggerNode";

export interface CortexEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface CompileContext {
  /** Token do flow — prefixo do webhook path e tab ID */
  flowToken?: string;
  /** Base URL interna do Cortex Flow API (para buscar tokens frescos) */
  cortexApiBase?: string;
  /** Map: cortexNodeId → gmailCredentialId (UUID na tabela gmail_credentials) */
  gmailCredentials?: Record<string, string>;
}

// Mantido para backward-compat com partes do código que ainda usam o tipo
export interface N8nWorkflowDefinition {
  nodes: any[];
  connections: Record<string, any>;
  settings: Record<string, any>;
}

@Injectable()
export class FlowCompilerService {
  /**
   * Transforma o grafo cortex-flow (React Flow) em um flow Node-RED válido.
   */
  compile(
    nodes: CortexNode[],
    edges: CortexEdge[],
    flowName: string,
    context: CompileContext = {},
  ): NodeRedFlowDefinition {
    const tabId = context.flowToken
      ? `cortex-${context.flowToken}`
      : `cortex-tab-${Date.now()}`;
    // Prefixo único por flow para evitar conflito de IDs no Node-RED
    const p = tabId.replace(/[^a-z0-9]/gi, "").substring(0, 8);

    if (!nodes || nodes.length === 0) {
      return this.emptyFlow(flowName, tabId, p);
    }

    const metaTypes: CortexNodeType[] = [
      "emailConnectionNode",
      "emailBodyNode",
    ];

    // ── Detecta tipo de trigger ──────────────────────────────────────────────
    const triggerNode = nodes.find(
      (n) =>
        n.type === "triggerNode" ||
        n.type === "webhookTriggerNode" ||
        n.type === "cronTriggerNode",
    );
    const triggerType: string = triggerNode
      ? (triggerNode.data?.triggerType as string) ||
        (triggerNode.type === "cronTriggerNode"
          ? "cron"
          : triggerNode.type === "webhookTriggerNode"
            ? "webhook"
            : "manual")
      : "manual";

    const isWebhook = triggerType === "webhook";

    // ── Monta lista de nodes Node-RED ────────────────────────────────────────
    const nrNodes: NodeRedNode[] = [];
    const envVars: Array<{ name: string; value: string; type: string }> = [];

    // ID do node de resposta HTTP (webhook flows e endpoint de exec manual)
    const httpResponseNodeId = `${p}_resp`;

    // Mapa: cortexId → nodeRedId do primeiro node downstream gerado
    // (para conectar trigger → ação)
    const cortexToNrId: Record<string, string> = {};

    // Processa sendEmailNodes primeiro, gera os nodes de ação
    for (const node of nodes) {
      if (node.type !== "sendEmailNode") continue;

      const { emailConn, emailBody } = this.findEmailDeps(
        node.id,
        nodes,
        edges,
      );

      const safe = node.id.replace(/-/g, "").substring(0, 8);

      // ID Node-RED do function node (prefixado com p para unicidade global)
      const funcNodeId = `${p}_f_${safe}`;

      // Resolve credential ID para este sendEmailNode
      const credentialId =
        context.gmailCredentials?.[node.id] ||
        context.gmailCredentials?.[emailConn?.id ?? ""] ||
        emailConn?.data?.gmailCredentialId ||
        "";

      const to = node.data?.toEmail || "";
      const subject = emailBody?.data?.subject || "";
      const body = emailBody?.data?.body || "";

      // ENV vars escopadas por node
      const envPrefix = `NR_EMAIL_${safe}`;
      envVars.push(
        { name: `${envPrefix}_CRED_ID`, value: credentialId, type: "str" },
        { name: `${envPrefix}_TO`, value: to, type: "str" },
        { name: `${envPrefix}_SUBJECT`, value: subject, type: "str" },
        { name: `${envPrefix}_BODY`, value: body, type: "str" },
      );

      const cortexApiBase =
        context.cortexApiBase || "http://cortex-flow-api:3000";
      envVars.push(
        {
          name: "CORTEX_API_BASE",
          value: cortexApiBase,
          type: "str",
        },
        {
          name: "GMAIL_ENABLE_URL",
          value:
            "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
          type: "str",
        },
      );

      // Function node: busca token, monta MIME e envia via Gmail API
      const funcCode = this.buildGmailFunctionCode(envPrefix);
      const funcNode: NodeRedNode = {
        id: funcNodeId,
        type: "function",
        z: tabId,
        name: "Enviar Email",
        func: funcCode,
        outputs: 1,
        noerr: 0,
        initialize: "",
        finalize: "",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        // Vai direto ao http response — o envio já é feito dentro da função
        wires: [[httpResponseNodeId]],
      };

      nrNodes.push(funcNode);
      cortexToNrId[node.id] = funcNodeId;
    }

    // SEMPRE adiciona http response (responde a chamadas API/webhook;
    // é no-op quando mensagem não tem ctx HTTP — inject cron)
    nrNodes.push({
      id: httpResponseNodeId,
      type: "http response",
      z: tabId,
      name: "Resposta",
      statusCode: "200",
      headers: {},
      x: 850,
      y: 200,
      wires: [],
    });

    // Processa trigger node
    if (triggerNode) {
      const safe = triggerNode.id.replace(/-/g, "").substring(0, 8);

      // Descobre qual node Node-RED está downstream (via edges)
      const downstreamNrId = this.findDownstreamNrId(
        triggerNode.id,
        nodes,
        edges,
        metaTypes,
        cortexToNrId,
      );

      const triggerWires = downstreamNrId ? [[downstreamNrId]] : [[]];

      if (isWebhook) {
        // Webhook flow: http in É o trigger principal
        const webhookPath = context.flowToken || triggerNode.id;
        const method = (
          (triggerNode.data?.httpMethod as string) || "POST"
        ).toLowerCase();
        const whNodeId = `${p}_wh_${safe}`;

        nrNodes.push({
          id: whNodeId,
          type: "http in",
          z: tabId,
          name: "Webhook",
          url: `/webhook/${webhookPath}`,
          method,
          upload: false,
          x: Math.round(triggerNode.position.x),
          y: Math.round(triggerNode.position.y),
          wires: triggerWires,
        });

        cortexToNrId[triggerNode.id] = whNodeId;
      } else if (triggerType === "cron") {
        const cronExp =
          (triggerNode.data?.cronExpression as string)?.trim() || "0 8 * * 1-5";
        const injNodeId = `inj_${safe}`;

        nrNodes.push({
          id: injNodeId,
          type: "inject",
          z: tabId,
          name: "Agendamento",
          props: [{ p: "payload" }, { p: "topic", vt: "str" }],
          repeat: "",
          crontab: cronExp,
          once: false,
          onceDelay: 0.1,
          topic: "",
          payload: "",
          payloadType: "date",
          x: Math.round(triggerNode.position.x),
          y: Math.round(triggerNode.position.y),
          wires: triggerWires,
        });

        cortexToNrId[triggerNode.id] = injNodeId;

        // Adiciona http in auxiliar para execução manual via API
        const webhookPath = context.flowToken || triggerNode.id;
        nrNodes.push({
          id: `${p}_wha_${safe}`,
          type: "http in",
          z: tabId,
          name: "Exec Manual API",
          url: `/webhook/${webhookPath}`,
          method: "post",
          upload: false,
          x: Math.round(triggerNode.position.x),
          y: Math.round(triggerNode.position.y) + 80,
          // Wire para o mesmo downstream que o inject
          wires: triggerWires,
        });
      } else {
        // Manual trigger: apenas http in (execuçãão via API)
        const webhookPath = context.flowToken || triggerNode.id;
        const injNodeId = `${p}_inj_${safe}`;
        const apiNodeId = `${p}_wha_${safe}`;

        nrNodes.push(
          {
            id: injNodeId,
            type: "inject",
            z: tabId,
            name: "Início Manual",
            props: [{ p: "payload" }],
            repeat: "",
            crontab: "",
            once: false,
            onceDelay: 0.1,
            topic: "",
            payload: "{}",
            payloadType: "json",
            x: Math.round(triggerNode.position.x),
            y: Math.round(triggerNode.position.y),
            wires: triggerWires,
          },
          {
            id: apiNodeId,
            type: "http in",
            z: tabId,
            name: "Exec via API",
            url: `/webhook/${webhookPath}`,
            method: "post",
            upload: false,
            x: Math.round(triggerNode.position.x),
            y: Math.round(triggerNode.position.y) + 80,
            wires: triggerWires,
          },
        );

        cortexToNrId[triggerNode.id] = injNodeId;
      }
    } else if (context.flowToken) {
      // Sem trigger node: adiciona só o http in de exec via API
      const safe = "default";
      const downstreamIds = Object.values(cortexToNrId);
      nrNodes.push({
        id: `${p}_wha_${safe}`,
        type: "http in",
        z: tabId,
        name: "Exec via API",
        url: `/webhook/${context.flowToken}`,
        method: "post",
        upload: false,
        x: 120,
        y: 100,
        wires: [downstreamIds.length > 0 ? [downstreamIds[0]] : []],
      });
    }

    // Deduplica CORTEX_API_BASE (pode aparecer múltiplas vezes)
    const seenEnv = new Set<string>();
    const dedupedEnv = envVars.filter((e) => {
      if (seenEnv.has(e.name)) return false;
      seenEnv.add(e.name);
      return true;
    });

    return {
      id: tabId,
      label: flowName,
      disabled: false,
      info: "",
      env: dedupedEnv,
      nodes: nrNodes,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private findEmailDeps(
    sendNodeId: string,
    nodes: CortexNode[],
    edges: CortexEdge[],
  ): { emailConn: CortexNode | null; emailBody: CortexNode | null } {
    let emailConn: CortexNode | null = null;
    let emailBody: CortexNode | null = null;

    // Busca recursiva para trás nas arestas a partir do sendNodeId
    const traverse = (nodeId: string, visited = new Set<string>()) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const incomingSourceIds = edges
        .filter((e) => e.target === nodeId)
        .map((e) => e.source);

      for (const srcId of incomingSourceIds) {
        const srcNode = nodes.find((n) => n.id === srcId);
        if (!srcNode) continue;
        if (srcNode.type === "emailConnectionNode") emailConn = srcNode;
        if (srcNode.type === "emailBodyNode") emailBody = srcNode;
        traverse(srcId, visited);
      }
    };

    traverse(sendNodeId);

    // Fallback: se não achou por edges, pega o primeiro do tipo (fluxo simples)
    if (!emailConn) {
      emailConn = nodes.find((n) => n.type === "emailConnectionNode") ?? null;
    }
    if (!emailBody) {
      emailBody = nodes.find((n) => n.type === "emailBodyNode") ?? null;
    }

    return { emailConn, emailBody };
  }

  private findDownstreamNrId(
    sourceId: string,
    nodes: CortexNode[],
    edges: CortexEdge[],
    metaTypes: CortexNodeType[],
    cortexToNrId: Record<string, string>,
    visited: Set<string> = new Set(),
  ): string | null {
    if (visited.has(sourceId)) return null;
    visited.add(sourceId);

    const targets = edges
      .filter((e) => e.source === sourceId)
      .map((e) => e.target);

    for (const targetId of targets) {
      const targetNode = nodes.find((n) => n.id === targetId);
      if (!targetNode) continue;

      // Se é metaType (emailConnectionNode, emailBodyNode), atravessa recursivamente
      if (metaTypes.includes(targetNode.type)) {
        const deeper = this.findDownstreamNrId(
          targetId,
          nodes,
          edges,
          metaTypes,
          cortexToNrId,
          visited,
        );
        if (deeper) return deeper;
        continue;
      }

      if (cortexToNrId[targetId]) return cortexToNrId[targetId];
    }

    return null;
  }

  private buildGmailFunctionCode(envPrefix: string): string {
    return `
// ── Cortex Flow: Envio de Email via Gmail API ────────────────────────────────
const credId = env.get("${envPrefix}_CRED_ID");
const apiBase = env.get("CORTEX_API_BASE");
const enableUrl = env.get("GMAIL_ENABLE_URL") || "https://console.cloud.google.com/apis/library/gmail.googleapis.com";

// Remove placeholders {{...}} — substituídos por dados reais do payload
const resolveField = (envVal, payloadVal) => {
  const v = envVal && !envVal.includes('{{') ? envVal : (payloadVal || '');
  return v;
};

const to = resolveField(env.get("${envPrefix}_TO"), msg.payload && msg.payload.to);
const subject = resolveField(env.get("${envPrefix}_SUBJECT"), msg.payload && msg.payload.subject);
const body = resolveField(env.get("${envPrefix}_BODY"), msg.payload && msg.payload.body);

// Helper: responde com erro (sem travar o webhook HTTP)
function fail(message, extraData) {
  node.error(message);
  msg.statusCode = 500;
  msg.payload = JSON.stringify(Object.assign({ success: false, error: message }, extraData || {}));
  node.send(msg);
}

if (!credId) { return fail("Gmail credential não configurado"); }
if (!to) { return fail("Destinatário não informado. Preencha o campo 'Para' no node ou passe { to: '...' } no payload."); }

const _fetch = global.get('fetch');
if (!_fetch) { return fail("fetch não disponível no contexto global do Node-RED"); }

// 1. Busca token OAuth2 fresco no Cortex Flow API
let accessToken;
try {
  const tokenRes = await _fetch(\`\${apiBase}/flows/internal/credentials/gmail/\${credId}/token\`);
  if (!tokenRes.ok) throw new Error("Token endpoint retornou " + tokenRes.status);
  const tokenData = await tokenRes.json();
  accessToken = tokenData.accessToken;
} catch (e) {
  return fail("Falha ao obter token Gmail: " + e.message);
}

// 2. Monta email RFC 2822
const emailLines = [
  "From: me",
  "To: " + to,
  "Subject: " + subject,
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=UTF-8",
  "",
  body
];
const rawEmail = emailLines.join("\\r\\n");
const encoded = Buffer.from(rawEmail)
  .toString("base64")
  .replace(/\\+/g, "-")
  .replace(/\\//g, "_")
  .replace(/=+$/, "");

// 3. Envia via Gmail API
let sendRes;
try {
  sendRes = await _fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: encoded })
  });
} catch (e) {
  return fail("Erro de rede ao chamar Gmail API: " + e.message);
}

if (!sendRes.ok) {
  const errBody = await sendRes.json().catch(() => ({}));
  const reason = (errBody?.error?.errors || [])[0]?.reason || "";
  if (sendRes.status === 403 && reason === "accessNotConfigured") {
    return fail("Gmail API não habilitada no Google Cloud.", { enableUrl: enableUrl });
  }
  return fail("Gmail API erro " + sendRes.status + ": " + JSON.stringify(errBody?.error?.message || errBody));
}

msg.statusCode = 200;
msg.payload = JSON.stringify({ success: true, to, subject });
return msg;
`.trim();
  }

  private emptyFlow(
    name: string,
    tabId: string,
    prefix?: string,
  ): NodeRedFlowDefinition {
    const p = prefix || tabId.replace(/[^a-z0-9]/gi, "").substring(0, 8);
    return {
      id: tabId,
      label: name,
      disabled: false,
      info: "",
      env: [],
      nodes: [
        {
          id: `${p}_inj`,
          type: "inject",
          z: tabId,
          name: "Início",
          props: [{ p: "payload" }],
          repeat: "",
          crontab: "",
          once: false,
          payload: "{}",
          payloadType: "json",
          x: 120,
          y: 100,
          wires: [[]],
        },
      ],
    };
  }
}
