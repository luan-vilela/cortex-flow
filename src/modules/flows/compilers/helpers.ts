/**
 * Utilitários compartilhados entre node compilers.
 */
import type { CortexNode, CortexEdge, CortexNodeType } from "./types";

/**
 * Gera o safe ID de 8 caracteres a partir do UUID do nó Cortex.
 */
export function safeId(nodeId: string): string {
  return nodeId.replace(/-/g, "").substring(0, 8);
}

/**
 * Encontra o primeiro nó Node-RED downstream de um nó Cortex,
 * atravessando nós "meta" (emailConnectionNode, emailBodyNode).
 */
export function findDownstreamNrId(
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

    if (metaTypes.includes(targetNode.type)) {
      const deeper = findDownstreamNrId(
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
 * Encontra o primeiro nó Node-RED downstream de um sourceHandle específico.
 * Usado por nós com múltiplas saídas (ex: ifNode → "true" / "false").
 */
export function findDownstreamNrIdByHandle(
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
      const deeper = findDownstreamNrId(
        targetId,
        nodes,
        edges,
        metaTypes,
        cortexToNrId,
      );
      if (deeper) return deeper;
      continue;
    }

    if (cortexToNrId[targetId]) return cortexToNrId[targetId];
  }

  return null;
}

/**
 * Template render function code — reutilizado em function nodes do Node-RED.
 * Retorna o código JS como string para ser injetado em func: `...`.
 */
export const RENDER_FUNCTION_CODE = `
const render = (template, data) => {
  if (!template) return '';
  return String(template).replace(/{{\\s*([a-zA-Z0-9_.()]+)\\s*}}/g, (_, key) => {
    if (key === 'all()') return JSON.stringify(data, null, 2);
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), data);
    return val !== undefined && val !== null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : '';
  });
};`.trim();
