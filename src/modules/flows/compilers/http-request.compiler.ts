/**
 * Compiler: httpRequestNode
 *
 * Gera cadeia de 3 nós:
 *   [setup function] → [http request] → [post-process function]
 */
import type { NodeRedNode } from "../../node-red-bridge/node-red-bridge.service";
import type { CompilationBag, NodeCompileResult, EnvVar } from "./types";
import { safeId, findDownstreamNrId, RENDER_FUNCTION_CODE } from "./helpers";

export function compileHttpRequest(bag: CompilationBag): NodeCompileResult {
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
    if (node.type !== "httpRequestNode") continue;

    const safe = safeId(node.id);
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
      { name: `${envPrefix}_RESP_VAR`, value: responseVariable, type: "str" },
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
${RENDER_FUNCTION_CODE}
const ctx = msg.payload || {};

// Salva payload anterior para restaurar pos-request
msg._cortexCtx = ctx;

const method = env.get("${envPrefix}_METHOD") || "GET";
const rawUrl = env.get("${envPrefix}_URL") || "";
const authType = env.get("${envPrefix}_AUTH_TYPE") || "none";

msg.method = method;
msg.url = render(rawUrl, ctx);

// Reescreve URLs que apontam para o host via porta mapeada do Node-RED
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

    // Descobre downstream do httpRequestNode
    const mergedMap = { ...existingMap, ...cortexToNrId };
    const downstreamNrId = findDownstreamNrId(
      node.id,
      nodes,
      edges,
      metaTypes,
      mergedMap,
    );
    const afterRequestWires = downstreamNrId
      ? [[downstreamNrId]]
      : [[fallbackResponseId]];

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

    // Registra o primeiro nó da cadeia (setup)
    cortexToNrId[node.id] = setupFuncId;
  }

  return { nodes: nrNodes, envVars, cortexToNrId };
}
