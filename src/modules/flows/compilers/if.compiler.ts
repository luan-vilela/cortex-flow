/**
 * Compiler: ifNode
 *
 * Gera um function node com 2 outputs:
 *   output 0 → condição verdadeira (handle "true")
 *   output 1 → condição falsa (handle "false")
 */
import type { NodeRedNode } from "../../node-red-bridge/node-red-bridge.service";
import type { CompilationBag, NodeCompileResult, EnvVar } from "./types";
import {
  safeId,
  findDownstreamNrIdByHandle,
  RENDER_FUNCTION_CODE,
} from "./helpers";

export function compileIf(bag: CompilationBag): NodeCompileResult {
  const {
    tabId,
    prefix: p,
    nodes,
    edges,
    metaTypes,
    cortexToNrId: existingMap,
  } = bag;

  const nrNodes: NodeRedNode[] = [];
  const envVars: EnvVar[] = [];
  const cortexToNrId: Record<string, string> = {};

  for (const node of nodes) {
    if (node.type !== "ifNode") continue;

    const safe = safeId(node.id);
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
    const mergedMap = { ...existingMap, ...cortexToNrId };
    const trueTarget = findDownstreamNrIdByHandle(
      node.id,
      "true",
      nodes,
      edges,
      metaTypes,
      mergedMap,
    );
    const falseTarget = findDownstreamNrIdByHandle(
      node.id,
      "false",
      nodes,
      edges,
      metaTypes,
      mergedMap,
    );

    const trueWires = trueTarget ? [trueTarget] : [];
    const falseWires = falseTarget ? [falseTarget] : [];

    const ifFunc = `
${RENDER_FUNCTION_CODE}
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

  return { nodes: nrNodes, envVars, cortexToNrId };
}
