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
  | "gmailNode"
  | "webhookTriggerNode"
  | "cronTriggerNode"
  | "httpResponseNode"
  | "httpRequestNode"
  | "ifNode"
  | "waitNode";

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

    // ── Coleta safe-ids de nós desabilitados para marcar d:true depois ───────
    // Cada nó Cortex pode gerar N nós Node-RED; todos compartilham o mesmo
    // sufixo "safe" (8 chars do UUID sem hífens). Marcamos d:true em todos
    // eles após a compilação, usando o comportamento nativo do Node-RED.
    const disabledSafeIds = new Set(
      nodes
        .filter((n) => n.data?.disabled === true)
        .map((n) => n.id.replace(/-/g, "").substring(0, 8)),
    );

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
      if (node.type !== "sendEmailNode" && node.type !== "gmailNode") continue;

      const isGmailNode = node.type === "gmailNode";

      // Para gmailNode: todos os dados vêm direto do próprio node
      // Para sendEmailNode: busca deps (emailConnectionNode + emailBodyNode)
      let credentialId: string;
      let to: string;
      let subject: string;
      let body: string;
      let cc: string;
      let bcc: string;

      if (isGmailNode) {
        credentialId =
          node.data?.gmailCredentialId || node.data?.credentialId || "";
        to = node.data?.toEmail || "";
        cc = node.data?.ccEmail || "";
        bcc = node.data?.bccEmail || "";
        subject = node.data?.subject || "";
        body = node.data?.body || "";
      } else {
        const { emailConn, emailBody } = this.findEmailDeps(
          node.id,
          nodes,
          edges,
        );
        credentialId =
          context.gmailCredentials?.[node.id] ||
          context.gmailCredentials?.[emailConn?.id ?? ""] ||
          emailConn?.data?.gmailCredentialId ||
          "";
        to = node.data?.toEmail || "";
        cc = "";
        bcc = "";
        subject = emailBody?.data?.subject || "";
        body = emailBody?.data?.body || "";
      }

      const safe = node.id.replace(/-/g, "").substring(0, 8);

      // ID Node-RED do function node (prefixado com p para unicidade global)
      const funcNodeId = `${p}_f_${safe}`;

      // ENV vars escopadas por node
      const envPrefix = `NR_EMAIL_${safe}`;
      envVars.push(
        { name: `${envPrefix}_CRED_ID`, value: credentialId, type: "str" },
        { name: `${envPrefix}_TO`, value: to, type: "str" },
        { name: `${envPrefix}_CC`, value: cc, type: "str" },
        { name: `${envPrefix}_BCC`, value: bcc, type: "str" },
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

    // ── Processa httpResponseNode (nó customizado do Cortex) ────────────────
    // Mapeia cada httpResponseNode do canvas para o nó http response do NR.
    // Se houver body configurado, insere um function node que seta msg.payload
    // antes de responder.
    const cortexResponseNodes = nodes.filter(
      (n) => n.type === "httpResponseNode",
    );

    let resolvedStatusCode = "200";
    let resolvedBody: string | null = null;
    let resolvedContentType = "application/json";

    if (cortexResponseNodes.length > 0) {
      const rn = cortexResponseNodes[0];
      resolvedStatusCode = (rn.data?.statusCode as string) || "200";
      resolvedBody = (rn.data?.body as string) || null;
      resolvedContentType =
        (rn.data?.contentType as string) || "application/json";

      if (resolvedBody) {
        // Insere function node que define payload e content-type antes de responder
        const rnSafe = rn.id.replace(/-/g, "").substring(0, 8);
        const bodyFuncId = `${p}_rbody_${rnSafe}`;
        const envPrefixResp = `NR_RESP_${rnSafe}`;

        envVars.push(
          { name: `${envPrefixResp}_BODY`, value: resolvedBody, type: "str" },
          {
            name: `${envPrefixResp}_CT`,
            value: resolvedContentType,
            type: "str",
          },
        );

        nrNodes.push({
          id: bodyFuncId,
          type: "function",
          z: tabId,
          name: "Montar Resposta",
          func: `
const render = (template, data) => {
  if (!template) return '';
  return template.replace(/{{\s*([a-zA-Z0-9_.()]+)\s*}}/g, (_, key) => {
    if (key === 'all()') return JSON.stringify(data, null, 2);
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), data);
    return val !== undefined && val !== null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : '';
  });
};
const bodyTemplate = env.get("${envPrefixResp}_BODY");
const ct = env.get("${envPrefixResp}_CT") || "application/json";
const payload = msg.payload || {};
msg.payload = render(bodyTemplate, payload);
msg.headers = msg.headers || {};
msg.headers["Content-Type"] = ct;
msg.statusCode = ${resolvedStatusCode};
return msg;
`,
          outputs: 1,
          noerr: 0,
          initialize: "",
          finalize: "",
          x: Math.round(rn.position.x),
          y: Math.round(rn.position.y),
          wires: [[httpResponseNodeId]],
        });

        cortexToNrId[rn.id] = bodyFuncId;
      } else {
        // Sem body: status code via function simples
        const rnSafe = rn.id.replace(/-/g, "").substring(0, 8);
        const statusFuncId = `${p}_rstatus_${rnSafe}`;

        nrNodes.push({
          id: statusFuncId,
          type: "function",
          z: tabId,
          name: "Definir Status",
          func: `msg.statusCode = ${resolvedStatusCode}; return msg;`,
          outputs: 1,
          noerr: 0,
          initialize: "",
          finalize: "",
          x: Math.round(rn.position.x),
          y: Math.round(rn.position.y),
          wires: [[httpResponseNodeId]],
        });

        cortexToNrId[rn.id] = statusFuncId;
      }
    }

    // SEMPRE adiciona http response (responde a chamadas API/webhook;
    // é no-op quando mensagem não tem ctx HTTP — inject cron)
    nrNodes.push({
      id: httpResponseNodeId,
      type: "http response",
      z: tabId,
      name: "Resposta",
      statusCode: resolvedBody ? "" : resolvedStatusCode,
      headers: {},
      x: 850,
      y: 200,
      wires: [],
    });

    // ── Processa httpRequestNode ─────────────────────────────────────────────
    // Gera cadeia: [setup function] → [http request] → [post-process function]
    // O setup function é registrado em cortexToNrId para que o trigger possa
    // conectar a ele corretamente.
    for (const node of nodes) {
      if (node.type !== "httpRequestNode") continue;

      const safe = node.id.replace(/-/g, "").substring(0, 8);
      const setupFuncId = `${p}_hrf_${safe}`;
      const httpReqNrId = `${p}_hrn_${safe}`;
      const postProcessId = `${p}_hrp_${safe}`;
      const envPrefix = `NR_HTTPREQ_${safe}`;

      const d = node.data as Record<string, unknown>;
      const method = ((d.method as string) || "GET").toUpperCase();
      const url = (d.url as string) || "";
      const authType = (d.authType as string) || "none";
      const bearerToken = (d.bearerToken as string) || "";
      const basicUser = (d.basicUser as string) || "";
      const basicPassword = (d.basicPassword as string) || "";
      const apiKeyHeader = (d.apiKeyHeader as string) || "";
      const apiKeyValue = (d.apiKeyValue as string) || "";
      const customHeaders: Array<{ key: string; value: string }> =
        (d.headers as Array<{ key: string; value: string }>) || [];
      const body = (d.body as string) || "";
      const responseVariable = (d.responseVariable as string) || "httpResponse";

      // Armazena configs como env vars para não expor segredos no código
      envVars.push(
        { name: `${envPrefix}_URL`, value: url, type: "str" },
        { name: `${envPrefix}_METHOD`, value: method, type: "str" },
        { name: `${envPrefix}_AUTH_TYPE`, value: authType, type: "str" },
        { name: `${envPrefix}_BEARER`, value: bearerToken, type: "str" },
        { name: `${envPrefix}_BASIC_USER`, value: basicUser, type: "str" },
        { name: `${envPrefix}_BASIC_PASS`, value: basicPassword, type: "str" },
        { name: `${envPrefix}_APIKEY_HDR`, value: apiKeyHeader, type: "str" },
        { name: `${envPrefix}_APIKEY_VAL`, value: apiKeyValue, type: "str" },
        { name: `${envPrefix}_BODY`, value: body, type: "str" },
        {
          name: `${envPrefix}_RESP_VAR`,
          value: responseVariable,
          type: "str",
        },
      );
      if (customHeaders.length > 0) {
        envVars.push({
          name: `${envPrefix}_CUSTOM_HEADERS`,
          value: JSON.stringify(customHeaders),
          type: "str",
        });
      }

      // Função de setup: prepara URL, headers, auth e body do request
      const setupFunc = `
const render = (template, data) => {
  if (!template) return template == null ? '' : String(template);
  return String(template).replace(/{{\\s*([a-zA-Z0-9_.()]+)\\s*}}/g, (_, key) => {
    if (key === 'all()') return JSON.stringify(data, null, 2);
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), data);
    return val !== undefined && val !== null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : '';
  });
};
const ctx = msg.payload || {};

// Salva payload anterior para restaurar pos-request
msg._cortexCtx = ctx;

const method = env.get("${envPrefix}_METHOD") || "GET";
const rawUrl = env.get("${envPrefix}_URL") || "";
const authType = env.get("${envPrefix}_AUTH_TYPE") || "none";

msg.method = method;
msg.url = render(rawUrl, ctx);

// Reescreve URLs que apontam para o host via porta mapeada do Node-RED
// Usa new RegExp (em vez de literal) para evitar perda de backslashes em template literals.
msg.url = msg.url.replace(new RegExp('https?://localhost:[0-9]+/'), 'http://node-red:1880/');

msg.headers = {};

// Auth
if (authType === "bearer") {
  const token = env.get("${envPrefix}_BEARER") || "";
  msg.headers["Authorization"] = "Bearer " + render(token, ctx);
} else if (authType === "basic") {
  const user = env.get("${envPrefix}_BASIC_USER") || "";
  const pass = env.get("${envPrefix}_BASIC_PASS") || "";
  msg.headers["Authorization"] = "Basic " + Buffer.from(render(user, ctx) + ":" + render(pass, ctx)).toString("base64");
} else if (authType === "apikey") {
  const hdr = env.get("${envPrefix}_APIKEY_HDR") || "";
  const val = env.get("${envPrefix}_APIKEY_VAL") || "";
  if (hdr) msg.headers[hdr] = render(val, ctx);
}

// Headers customizados
const customHdrsRaw = env.get("${envPrefix}_CUSTOM_HEADERS");
if (customHdrsRaw) {
  try {
    const hdrs = JSON.parse(customHdrsRaw);
    for (const h of hdrs) {
      if (h.key) msg.headers[h.key] = render(h.value || "", ctx);
    }
  } catch(e) {}
}

// Body (apenas metodos com payload)
const bodyTpl = env.get("${envPrefix}_BODY") || "";
const bodyMethods = ["POST", "PUT", "PATCH"];
if (bodyMethods.includes(method) && bodyTpl) {
  const rendered = render(bodyTpl, ctx);
  try {
    msg.payload = JSON.parse(rendered);
    msg.headers["Content-Type"] = msg.headers["Content-Type"] || "application/json";
  } catch(e) {
    msg.payload = rendered;
  }
} else {
  msg.payload = undefined;
}

return msg;
`;

      // Função pós-request: captura resposta e mescla com contexto anterior
      const postFunc = `
const respVar = env.get("${envPrefix}_RESP_VAR") || "httpResponse";
const prevCtx = msg._cortexCtx || {};
const response = {
  status: msg.statusCode,
  body: msg.payload,
};
msg.payload = Object.assign({}, prevCtx, { [respVar]: response });
delete msg._cortexCtx;
return msg;
`;

      // Descobre downstream do httpRequestNode (normalmente httpResponseNode)
      const downstreamNrId = this.findDownstreamNrId(
        node.id,
        nodes,
        edges,
        metaTypes,
        cortexToNrId,
      );
      const afterRequestWires = downstreamNrId
        ? [[downstreamNrId]]
        : [[httpResponseNodeId]];

      // Nó 1: setup – prepara o request
      nrNodes.push({
        id: setupFuncId,
        type: "function",
        z: tabId,
        name: `Preparar ${method}`,
        func: setupFunc,
        outputs: 1,
        noerr: 0,
        initialize: "",
        finalize: "",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y) - 60,
        wires: [[httpReqNrId]],
      });

      // Nó 2: http request – executa a chamada HTTP
      nrNodes.push({
        id: httpReqNrId,
        type: "http request",
        z: tabId,
        name: `${method} Request`,
        method: method,
        ret: "obj",
        paytoqs: method === "GET" ? "query" : "ignore",
        url: "{{{url}}}",
        tls: "",
        persist: false,
        proxy: "",
        insecureHTTPParser: false,
        authType: "",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        wires: [[postProcessId]],
      });

      // Nó 3: post-process – captura resposta no contexto do fluxo
      nrNodes.push({
        id: postProcessId,
        type: "function",
        z: tabId,
        name: "Capturar Resposta",
        func: postFunc,
        outputs: 1,
        noerr: 0,
        initialize: "",
        finalize: "",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y) + 60,
        wires: afterRequestWires,
      });

      // Registra o primeiro nó da cadeia para que nós upstream possam conectar
      cortexToNrId[node.id] = setupFuncId;
    }

    // ── Processa waitNode ──────────────────────────────────────────────────────
    // Usa o nó nativo "delay" do Node-RED.
    for (const node of nodes) {
      if (node.type !== "waitNode") continue;

      const safe = node.id.replace(/-/g, "").substring(0, 8);
      const delayNodeId = `${p}_dly_${safe}`;

      const seconds = Number(node.data?.seconds) || 0;

      const downstreamNrId = this.findDownstreamNrId(
        node.id,
        nodes,
        edges,
        metaTypes,
        cortexToNrId,
      );
      const afterWires = downstreamNrId
        ? [[downstreamNrId]]
        : [[httpResponseNodeId]];

      nrNodes.push({
        id: delayNodeId,
        type: "delay",
        z: tabId,
        name: `Aguardar ${seconds}s`,
        pauseType: "delay",
        timeout: String(seconds),
        timeoutUnits: "seconds",
        rate: "1",
        nbRateUnits: "1",
        rateUnits: "second",
        randomFirst: "1",
        randomLast: "5",
        randomUnits: "seconds",
        drop: false,
        allowrate: false,
        outputs: 1,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        wires: afterWires,
      });

      cortexToNrId[node.id] = delayNodeId;
    }

    // ── Processa ifNode ────────────────────────────────────────────────────────
    // Gera um function node com 2 outputs:
    //   output 0 → condição verdadeira (handle "true")
    //   output 1 → condição falsa (handle "false")
    for (const node of nodes) {
      if (node.type !== "ifNode") continue;

      const safe = node.id.replace(/-/g, "").substring(0, 8);
      const funcNodeId = `${p}_if_${safe}`;
      const envPrefix = `NR_IF_${safe}`;

      const d = node.data as Record<string, unknown>;
      const leftValue = (d.leftValue as string) || "";
      const operator = (d.operator as string) || "equals";
      const rightValue = (d.rightValue as string) || "";

      envVars.push(
        { name: `${envPrefix}_LEFT`, value: leftValue, type: "str" },
        { name: `${envPrefix}_OP`, value: operator, type: "str" },
        { name: `${envPrefix}_RIGHT`, value: rightValue, type: "str" },
      );

      // Descobre downstream por handle
      const trueTarget = this.findDownstreamNrIdByHandle(
        node.id, "true", nodes, edges, metaTypes, cortexToNrId,
      );
      const falseTarget = this.findDownstreamNrIdByHandle(
        node.id, "false", nodes, edges, metaTypes, cortexToNrId,
      );

      const trueWires = trueTarget ? [trueTarget] : [];
      const falseWires = falseTarget ? [falseTarget] : [];

      const ifFunc = `
const render = (template, data) => {
  if (!template) return '';
  return String(template).replace(/{{\\s*([a-zA-Z0-9_.()]+)\\s*}}/g, (_, key) => {
    if (key === 'all()') return JSON.stringify(data, null, 2);
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), data);
    return val !== undefined && val !== null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : '';
  });
};
const ctx = msg.payload || {};
const left = render(env.get("${envPrefix}_LEFT"), ctx);
const op = env.get("${envPrefix}_OP") || "equals";
const right = render(env.get("${envPrefix}_RIGHT"), ctx);

let result = false;
switch (op) {
  case "equals":       result = left === right; break;
  case "not_equals":   result = left !== right; break;
  case "contains":     result = left.includes(right); break;
  case "not_contains": result = !left.includes(right); break;
  case "greater_than": result = Number(left) > Number(right); break;
  case "less_than":    result = Number(left) < Number(right); break;
  case "is_empty":     result = !left || left.trim() === ""; break;
  case "is_not_empty": result = !!left && left.trim() !== ""; break;
}

if (result) {
  return [msg, null];
} else {
  return [null, msg];
}
`;

      nrNodes.push({
        id: funcNodeId,
        type: "function",
        z: tabId,
        name: "If / Condição",
        func: ifFunc,
        outputs: 2,
        noerr: 0,
        initialize: "",
        finalize: "",
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        wires: [trueWires, falseWires],
      });

      cortexToNrId[node.id] = funcNodeId;
    }

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

      // Se não há downstream explícito, vai direto ao http response
      // (garante que webhooks sempre respondem mesmo sem nós intermediários)
      const triggerWires = downstreamNrId
        ? [[downstreamNrId]]
        : [[httpResponseNodeId]];

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

    // ── Aplica d:true nos NR nodes gerados por nós Cortex desabilitados ──────
    // Todos os NR nodes de um nó Cortex têm IDs com o padrão "*_<safe>",
    // onde safe = primeiros 8 chars do UUID sem hífens.
    if (disabledSafeIds.size > 0) {
      for (const nrNode of nrNodes) {
        const parts = nrNode.id.split("_");
        const suffix = parts[parts.length - 1];
        if (disabledSafeIds.has(suffix)) {
          nrNode.d = true;
        }
      }
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

  /**
   * Finds the downstream Node-RED node ID for a specific sourceHandle.
   * Used by ifNode which has "true" and "false" outputs.
   */
  private findDownstreamNrIdByHandle(
    sourceId: string,
    handleId: string,
    nodes: CortexNode[],
    edges: CortexEdge[],
    metaTypes: CortexNodeType[],
    cortexToNrId: Record<string, string>,
  ): string | null {
    const targets = edges
      .filter((e) => e.source === sourceId && e.sourceHandle === handleId)
      .map((e) => e.target);

    for (const targetId of targets) {
      const targetNode = nodes.find((n) => n.id === targetId);
      if (!targetNode) continue;

      if (metaTypes.includes(targetNode.type)) {
        const deeper = this.findDownstreamNrId(
          targetId, nodes, edges, metaTypes, cortexToNrId,
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

// Substitui {{ variavel }} ou {{variavel}} pelos dados do payload
const render = (template, data) => {
  if (!template) return '';
  return template.replace(/{{ *([a-zA-Z0-9_]+) *}}/g, (_, key) => {
    const val = data && data[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
};

const rawPayload = (typeof msg.payload === 'object' && msg.payload !== null)
  ? msg.payload
  : {};
// Desempacota inputData se o payload veio como { inputData: {...} }
const payload = (rawPayload.inputData && typeof rawPayload.inputData === 'object')
  ? rawPayload.inputData
  : rawPayload;

const _toTemplate = env.get("${envPrefix}_TO");
node.warn("DEBUG raw: TO_env=" + JSON.stringify(_toTemplate) + " | payload=" + JSON.stringify(payload));

const to      = render(_toTemplate,                     payload).trim();
const cc      = render(env.get("${envPrefix}_CC"),      payload).trim();
const bcc     = render(env.get("${envPrefix}_BCC"),     payload).trim();
const subject = render(env.get("${envPrefix}_SUBJECT"), payload).trim();
const body    = render(env.get("${envPrefix}_BODY"),    payload);

node.warn("DEBUG cortex-flow: to=" + to + " | subject=" + subject + " | credId=" + credId + " | payloadKeys=" + Object.keys(payload).join(","));

// Helper: responde com erro (sem travar o webhook HTTP)
function fail(message, extraData) {
  node.error(message);
  msg.statusCode = 500;
  msg.payload = JSON.stringify(Object.assign({ success: false, error: message }, extraData || {}));
  node.send(msg);
}

if (!credId) { return fail("Gmail credential não configurado"); }
if (!to)     { return fail("Destinatário não informado. Preencha o campo 'Para' no node ou passe { to: '...' } no payload."); }

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
];
if (cc)  emailLines.push("Cc: " + cc);
if (bcc) emailLines.push("Bcc: " + bcc);
emailLines.push(
  "Subject: " + subject,
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=UTF-8",
  "",
  body
);
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
