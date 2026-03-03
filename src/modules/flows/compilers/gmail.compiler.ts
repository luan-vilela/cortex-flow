/**
 * Compiler: gmailNode / sendEmailNode
 *
 * Gera um function node que busca token OAuth2,
 * monta RFC 2822 e envia via Gmail REST API.
 */
import type { NodeRedNode } from "../../node-red-bridge/node-red-bridge.service";
import type {
  CompilationBag,
  NodeCompileResult,
  EnvVar,
  CortexNode,
  CortexEdge,
} from "./types";
import { safeId } from "./helpers";

// ── Helpers internos ─────────────────────────────────────────────────────────

function findEmailDeps(
  sendNodeId: string,
  nodes: CortexNode[],
  edges: CortexEdge[],
): { emailConn: CortexNode | null; emailBody: CortexNode | null } {
  let emailConn: CortexNode | null = null;
  let emailBody: CortexNode | null = null;

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

  if (!emailConn) {
    emailConn = nodes.find((n) => n.type === "emailConnectionNode") ?? null;
  }
  if (!emailBody) {
    emailBody = nodes.find((n) => n.type === "emailBodyNode") ?? null;
  }

  return { emailConn, emailBody };
}

function buildGmailFunctionCode(envPrefix: string): string {
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

// ── Compiler principal ──────────────────────────────────────────────────────

export function compileGmail(bag: CompilationBag): NodeCompileResult {
  const { tabId, prefix: p, fallbackResponseId, nodes, edges, context } = bag;

  const nrNodes: NodeRedNode[] = [];
  const envVars: EnvVar[] = [];
  const cortexToNrId: Record<string, string> = {};

  for (const node of nodes) {
    if (node.type !== "sendEmailNode" && node.type !== "gmailNode") continue;

    const isGmailNode = node.type === "gmailNode";

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
      const { emailConn, emailBody } = findEmailDeps(node.id, nodes, edges);
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

    const safe = safeId(node.id);
    const funcNodeId = `${p}_f_${safe}`;
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
      { name: "CORTEX_API_BASE", value: cortexApiBase, type: "str" },
      {
        name: "GMAIL_ENABLE_URL",
        value:
          "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
        type: "str",
      },
    );

    const funcCode = buildGmailFunctionCode(envPrefix);
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
      wires: [[fallbackResponseId]],
    };

    nrNodes.push(funcNode);
    cortexToNrId[node.id] = funcNodeId;
  }

  return { nodes: nrNodes, envVars, cortexToNrId };
}
