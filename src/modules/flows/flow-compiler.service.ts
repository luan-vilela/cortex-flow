import { Injectable } from "@nestjs/common";
import {
  NodeRedFlowDefinition,
  NodeRedNode,
} from "../node-red-bridge/node-red-bridge.service";
import {
  compileGmail,
  compileEmail,
  compileHttpResponse,
  compileHttpRequest,
  compileWait,
  compileIf,
  compileTrigger,
} from "./compilers";
import type {
  CortexNode,
  CortexNodeType,
  CortexEdge,
  CompileContext,
  CompilationBag,
  EnvVar,
  NodeCompileResult,
  N8nWorkflowDefinition,
} from "./compilers";
import { safeId } from "./compilers/helpers";

// Re-export para backward-compat (flows.service.ts importa daqui)
export type {
  CortexNode,
  CortexNodeType,
  CortexEdge,
  CompileContext,
  N8nWorkflowDefinition,
};

@Injectable()
export class FlowCompilerService {
  /**
   * Transforma o grafo cortex-flow (React Flow) em um flow Node-RED válido.
   *
   * Cada tipo de nó é compilado por um módulo dedicado em `./compilers/`.
   * A ordem de compilação importa: httpResponse e httpRequest devem ser
   * processados ANTES do trigger, pois este precisa do cortexToNrId populado.
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
    const p = tabId.replace(/[^a-z0-9]/gi, "").substring(0, 8);

    if (!nodes || nodes.length === 0) {
      return this.emptyFlow(flowName, tabId, p);
    }

    // ── Coleta safe-ids de nós desabilitados para marcar d:true depois ───────
    const disabledSafeIds = new Set(
      nodes.filter((n) => n.data?.disabled === true).map((n) => safeId(n.id)),
    );

    const metaTypes: CortexNodeType[] = [
      "emailConnectionNode",
      "emailBodyNode",
    ];

    // Fallback http response (para nós sem downstream explícito)
    const httpResponseNodeId = `${p}_resp`;

    // Mapa global: cortexId → nodeRedId (cresce a cada compiler)
    const cortexToNrId: Record<string, string> = {};

    // Acumuladores globais
    const allNrNodes: NodeRedNode[] = [];
    const allEnvVars: EnvVar[] = [];
    const allCredentials: Record<string, Record<string, string>> = {};

    // ── Bag compartilhado — atualizado com cortexToNrId a cada etapa ────────
    const makeBag = (): CompilationBag => ({
      tabId,
      prefix: p,
      fallbackResponseId: httpResponseNodeId,
      nodes,
      edges,
      metaTypes,
      cortexToNrId,
      context,
    });

    // ── Helper: mescla resultado de um compiler no acumulador global ────────
    const merge = (result: NodeCompileResult) => {
      allNrNodes.push(...result.nodes);
      allEnvVars.push(...result.envVars);
      Object.assign(cortexToNrId, result.cortexToNrId);
      if (result.credentials) {
        Object.assign(allCredentials, result.credentials);
      }
    };

    // ── Ordem de compilação ─────────────────────────────────────────────────
    // 1. Gmail (não depende de downstream)
    merge(compileGmail(makeBag()));

    // 1b. Email genérico SMTP (não depende de downstream)
    merge(compileEmail(makeBag()));

    // 2. HTTP Response (gera nós que outros podem referenciar)
    merge(compileHttpResponse(makeBag()));

    // 3. HTTP Request (precisa de httpResponseNode no cortexToNrId)
    merge(compileHttpRequest(makeBag()));

    // 4. Wait (precisa de downstream já registrado)
    merge(compileWait(makeBag()));

    // 5. If (precisa de downstream já registrado)
    merge(compileIf(makeBag()));

    // 6. Fallback http response (sempre presente)
    allNrNodes.push({
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

    // 7. Trigger (ÚLTIMO — precisa de cortexToNrId completo)
    merge(compileTrigger(makeBag()));

    // ── Aplica d:true nos NR nodes gerados por nós Cortex desabilitados ──────
    if (disabledSafeIds.size > 0) {
      for (const nrNode of allNrNodes) {
        const parts = nrNode.id.split("_");
        const suffix = parts[parts.length - 1];
        if (disabledSafeIds.has(suffix)) {
          nrNode.d = true;
        }
      }
    }

    // Deduplica env vars (ex: CORTEX_API_BASE pode aparecer múltiplas vezes)
    const seenEnv = new Set<string>();
    const dedupedEnv = allEnvVars.filter((e) => {
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
      nodes: allNrNodes,
      ...(Object.keys(allCredentials).length > 0 && {
        credentials: allCredentials,
      }),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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
