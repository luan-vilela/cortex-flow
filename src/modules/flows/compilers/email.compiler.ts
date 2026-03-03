/**
 * Compiler: emailNode (genérico SMTP)
 *
 * Gera um único function node que usa nodemailer diretamente para enviar email
 * via SMTP. Mesmo padrão do Gmail compiler (tudo num function node).
 *
 * O nodemailer é importado via `libs` do function node (functionExternalModules: true).
 * Credenciais SMTP ficam em env vars (não expostas no código do flow).
 */
import type { NodeRedNode } from "../../node-red-bridge/node-red-bridge.service";
import type { CompilationBag, NodeCompileResult, EnvVar } from "./types";
import { safeId, findDownstreamNrId } from "./helpers";

function buildSmtpFunctionCode(envPrefix: string): string {
  return `
// ── Cortex Flow: Envio de Email via SMTP (nodemailer) ────────────────────────
const render = (template, data) => {
  if (!template) return '';
  return template.replace(/{{ *([a-zA-Z0-9_.]+) *}}/g, (_, key) => {
    const val = data && data[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
};

const rawPayload = (typeof msg.payload === 'object' && msg.payload !== null)
  ? msg.payload
  : {};
const payload = (rawPayload.inputData && typeof rawPayload.inputData === 'object')
  ? rawPayload.inputData
  : rawPayload;

const smtpHost = env.get("${envPrefix}_HOST") || "";
const smtpPort = parseInt(env.get("${envPrefix}_PORT") || "587", 10);
const smtpUser = env.get("${envPrefix}_USER") || "";
const smtpPass = env.get("${envPrefix}_PASS") || "";
const smtpSecure = env.get("${envPrefix}_SECURE") === "true";

const fromDisplay = env.get("${envPrefix}_FROM") || smtpUser;
const to      = render(env.get("${envPrefix}_TO")      || "", payload).trim();
const cc      = render(env.get("${envPrefix}_CC")      || "", payload).trim();
const bcc     = render(env.get("${envPrefix}_BCC")     || "", payload).trim();
const subject = render(env.get("${envPrefix}_SUBJECT") || "", payload).trim();
const body    = render(env.get("${envPrefix}_BODY")    || "", payload);

// Helper: responde com erro sem travar o webhook HTTP
function fail(message) {
  node.error(message);
  msg.payload = { success: false, error: message };
  return node.send(msg);
}

if (!smtpHost) { return fail("Servidor SMTP não configurado"); }
if (!to)       { return fail("Destinatário não informado"); }

// Cria transporter SMTP via nodemailer
const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: smtpUser,
    pass: smtpPass
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Detecta se o corpo é HTML
const isHtml = body.includes("<") && body.includes(">");

const mailOptions = {
  from: fromDisplay,
  to: to,
  subject: subject
};

if (cc)  mailOptions.cc = cc;
if (bcc) mailOptions.bcc = bcc;

if (isHtml) {
  mailOptions.html = body;
  mailOptions.text = body.replace(/<[^>]*>/g, "");
} else {
  mailOptions.text = body;
}

try {
  const info = await transporter.sendMail(mailOptions);
  node.warn("Email enviado: " + info.messageId);
  msg.payload = Object.assign({}, payload, {
    emailResult: {
      success: true,
      messageId: info.messageId,
      to: to,
      subject: subject
    }
  });
  return msg;
} catch (err) {
  return fail("Erro ao enviar email: " + err.message);
}
`.trim();
}

// ── Compiler principal ──────────────────────────────────────────────────────

export function compileEmail(bag: CompilationBag): NodeCompileResult {
  const {
    tabId,
    prefix: p,
    fallbackResponseId,
    nodes,
    edges,
    metaTypes,
    cortexToNrId: existingMap,
  } = bag;

  const nrNodes: NodeRedNode[] = [];
  const envVars: EnvVar[] = [];
  const cortexToNrId: Record<string, string> = {};

  for (const node of nodes) {
    if (node.type !== "emailNode") continue;

    const safe = safeId(node.id);
    const funcNodeId = `${p}_emf_${safe}`;
    const envPrefix = `NR_EMAIL_SMTP_${safe}`;

    const d = node.data as Record<string, unknown>;
    const smtpHost = (d.smtpHost as string) || "";
    const smtpPort = String(Number(d.smtpPort) || 587);
    const smtpUser = (d.smtpUser as string) || "";
    const smtpPassword = (d.smtpPassword as string) || "";
    const smtpSecure = d.smtpSecure === true;
    const fromName = (d.fromName as string) || "";
    const fromEmail = (d.fromEmail as string) || smtpUser;
    const toEmail = (d.toEmail as string) || "";
    const ccEmail = (d.ccEmail as string) || "";
    const bccEmail = (d.bccEmail as string) || "";
    const subject = (d.subject as string) || "";
    const body = (d.body as string) || "";

    // From formatado
    const fromDisplay = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    // Env vars — credenciais e templates dinâmicos
    envVars.push(
      { name: `${envPrefix}_HOST`, value: smtpHost, type: "str" },
      { name: `${envPrefix}_PORT`, value: smtpPort, type: "str" },
      { name: `${envPrefix}_USER`, value: smtpUser, type: "str" },
      { name: `${envPrefix}_PASS`, value: smtpPassword, type: "str" },
      {
        name: `${envPrefix}_SECURE`,
        value: smtpSecure ? "true" : "false",
        type: "str",
      },
      { name: `${envPrefix}_FROM`, value: fromDisplay, type: "str" },
      { name: `${envPrefix}_TO`, value: toEmail, type: "str" },
      { name: `${envPrefix}_CC`, value: ccEmail, type: "str" },
      { name: `${envPrefix}_BCC`, value: bccEmail, type: "str" },
      { name: `${envPrefix}_SUBJECT`, value: subject, type: "str" },
      { name: `${envPrefix}_BODY`, value: body, type: "str" },
    );

    // Downstream
    const mergedMap = { ...existingMap, ...cortexToNrId };
    const downstreamNrId = findDownstreamNrId(
      node.id,
      nodes,
      edges,
      metaTypes,
      mergedMap,
    );

    const funcCode = buildSmtpFunctionCode(envPrefix);
    const funcNode: NodeRedNode = {
      id: funcNodeId,
      type: "function",
      z: tabId,
      name: "Enviar Email SMTP",
      func: funcCode,
      outputs: 1,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [{ var: "nodemailer", module: "nodemailer" }],
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      wires: [downstreamNrId ? [downstreamNrId] : [fallbackResponseId]],
    };

    nrNodes.push(funcNode);
    cortexToNrId[node.id] = funcNodeId;
  }

  return { nodes: nrNodes, envVars, cortexToNrId };
}
