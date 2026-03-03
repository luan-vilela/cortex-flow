/**
 * Compiler: triggerNode / webhookTriggerNode / cronTriggerNode
 *
 * Gera:
 *   - webhook  → "http in" node
 *   - cron     → "inject" node + "http in" auxiliar (exec manual)
 *   - manual   → "inject" node + "http in" auxiliar
 *   - sem trigger mas com flowToken → "http in" auxiliar
 */
import type { NodeRedNode } from "../../node-red-bridge/node-red-bridge.service";
import type {
  CompilationBag,
  NodeCompileResult,
  EnvVar,
  CortexNode,
} from "./types";
import { safeId, findDownstreamNrId } from "./helpers";

export function compileTrigger(bag: CompilationBag): NodeCompileResult {
  const {
    tabId,
    prefix: p,
    fallbackResponseId,
    nodes,
    edges,
    metaTypes,
    cortexToNrId: existingMap,
    context,
  } = bag;

  const nrNodes: NodeRedNode[] = [];
  const envVars: EnvVar[] = [];
  const cortexToNrId: Record<string, string> = {};

  // Detecta tipo de trigger
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

  if (triggerNode) {
    const safe = safeId(triggerNode.id);

    // Descobre downstream
    const mergedMap = { ...existingMap, ...cortexToNrId };
    const downstreamNrId = findDownstreamNrId(
      triggerNode.id,
      nodes,
      edges,
      metaTypes,
      mergedMap,
    );
    const triggerWires = downstreamNrId
      ? [[downstreamNrId]]
      : [[fallbackResponseId]];

    if (isWebhook) {
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

      // http in auxiliar para execução manual via API
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
        wires: triggerWires,
      });
    } else {
      // Manual trigger
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
    const allNrIds = Object.values(existingMap);
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
      wires: [allNrIds.length > 0 ? [allNrIds[0]] : []],
    });
  }

  return { nodes: nrNodes, envVars, cortexToNrId };
}
