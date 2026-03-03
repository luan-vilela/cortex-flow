/**
 * Compiler: waitNode
 *
 * Usa o nó nativo "delay" do Node-RED com pauseType: "delay".
 */
import type { NodeRedNode } from "../../node-red-bridge/node-red-bridge.service";
import type { CompilationBag, NodeCompileResult, EnvVar } from "./types";
import { safeId, findDownstreamNrId } from "./helpers";

export function compileWait(bag: CompilationBag): NodeCompileResult {
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
    if (node.type !== "waitNode") continue;

    const safe = safeId(node.id);
    const delayNodeId = `${p}_dly_${safe}`;

    const seconds = Number(node.data?.seconds) || 0;

    const mergedMap = { ...existingMap, ...cortexToNrId };
    const downstreamNrId = findDownstreamNrId(
      node.id,
      nodes,
      edges,
      metaTypes,
      mergedMap,
    );
    const afterWires = downstreamNrId
      ? [[downstreamNrId]]
      : [[fallbackResponseId]];

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

  return { nodes: nrNodes, envVars, cortexToNrId };
}
