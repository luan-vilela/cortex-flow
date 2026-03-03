/**
 * Compiler: httpResponseNode
 *
 * Cada httpResponseNode gera:
 *   - Se houver body: [function "Montar Resposta"] → [http response]
 *   - Se não houver body: [function "Definir Status"] → [http response]
 */
import type { NodeRedNode } from "../../node-red-bridge/node-red-bridge.service";
import type { CompilationBag, NodeCompileResult, EnvVar } from "./types";
import { safeId, RENDER_FUNCTION_CODE } from "./helpers";

export function compileHttpResponse(bag: CompilationBag): NodeCompileResult {
  const { tabId, prefix: p, nodes } = bag;

  const nrNodes: NodeRedNode[] = [];
  const envVars: EnvVar[] = [];
  const cortexToNrId: Record<string, string> = {};

  const cortexResponseNodes = nodes.filter(
    (n) => n.type === "httpResponseNode",
  );

  for (const rn of cortexResponseNodes) {
    const rnSafe = safeId(rn.id);
    const statusCode = (rn.data?.statusCode as string) || "200";
    const body = (rn.data?.body as string) || null;
    const contentType = (rn.data?.contentType as string) || "application/json";
    const respNrId = `${p}_hresp_${rnSafe}`;

    if (body) {
      const bodyFuncId = `${p}_rbody_${rnSafe}`;
      const envPrefixResp = `NR_RESP_${rnSafe}`;

      envVars.push(
        { name: `${envPrefixResp}_BODY`, value: body, type: "str" },
        { name: `${envPrefixResp}_CT`, value: contentType, type: "str" },
      );

      nrNodes.push({
        id: bodyFuncId,
        type: "function",
        z: tabId,
        name: "Montar Resposta",
        func: `
${RENDER_FUNCTION_CODE}
const bodyTemplate = env.get("${envPrefixResp}_BODY");
const ct = env.get("${envPrefixResp}_CT") || "application/json";
const payload = msg.payload || {};
msg.payload = render(bodyTemplate, payload);
msg.headers = msg.headers || {};
msg.headers["Content-Type"] = ct;
msg.statusCode = ${statusCode};
return msg;
`,
        outputs: 1,
        noerr: 0,
        initialize: "",
        finalize: "",
        x: Math.round(rn.position.x),
        y: Math.round(rn.position.y),
        wires: [[respNrId]],
      });

      cortexToNrId[rn.id] = bodyFuncId;
    } else {
      const statusFuncId = `${p}_rstatus_${rnSafe}`;

      nrNodes.push({
        id: statusFuncId,
        type: "function",
        z: tabId,
        name: "Definir Status",
        func: `msg.statusCode = ${statusCode}; return msg;`,
        outputs: 1,
        noerr: 0,
        initialize: "",
        finalize: "",
        x: Math.round(rn.position.x),
        y: Math.round(rn.position.y),
        wires: [[respNrId]],
      });

      cortexToNrId[rn.id] = statusFuncId;
    }

    // Cada httpResponseNode ganha seu próprio nó http response do Node-RED
    nrNodes.push({
      id: respNrId,
      type: "http response",
      z: tabId,
      name: `Resposta ${statusCode}`,
      statusCode: body ? "" : statusCode,
      headers: {},
      x: Math.round(rn.position.x) + 200,
      y: Math.round(rn.position.y),
      wires: [],
    });
  }

  return { nodes: nrNodes, envVars, cortexToNrId };
}
