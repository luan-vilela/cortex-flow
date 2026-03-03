/**
 * Tipos e interfaces compartilhados entre todos os node compilers.
 *
 * Cada compiler é uma função pura que recebe um CortexNode + contexto de compilação
 * e retorna os nós Node-RED correspondentes + env vars.
 */
import type { NodeRedNode } from "../../node-red-bridge/node-red-bridge.service";

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
  | "waitNode"
  | "emailNode";

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

// Mantido para backward-compat
export interface N8nWorkflowDefinition {
  nodes: any[];
  connections: Record<string, any>;
  settings: Record<string, any>;
}

// ── Env Var ───────────────────────────────────────────────────────────────────

export interface EnvVar {
  name: string;
  value: string;
  type: string;
}

// ── Node Compiler Result ──────────────────────────────────────────────────────

export interface NodeCompileResult {
  /** Nós Node-RED gerados por este compilador */
  nodes: NodeRedNode[];
  /** Variáveis de ambiente necessárias */
  envVars: EnvVar[];
  /**
   * Mapa: cortexNodeId → nodeRedId do primeiro nó gerado.
   * Usado para que nós upstream possam conectar ao nó correto.
   */
  cortexToNrId: Record<string, string>;
  /**
   * Credenciais de nós (userid, password, etc) — passadas separadamente
   * ao Node-RED via POST /flow { credentials: { nodeId: { ... } } }.
   */
  credentials?: Record<string, Record<string, string>>;
}

// ── Compilation Bag ───────────────────────────────────────────────────────────
// Contexto passado a cada node compiler para acesso ao grafo completo.

export interface CompilationBag {
  /** Tab ID do Node-RED */
  tabId: string;
  /** Prefixo curto para IDs únicos */
  prefix: string;
  /** ID do http response fallback (para nós sem downstream) */
  fallbackResponseId: string;
  /** Todos os nós do fluxo */
  nodes: CortexNode[];
  /** Todas as conexões do fluxo */
  edges: CortexEdge[];
  /** Tipos "meta" que devem ser atravessados ao buscar downstream */
  metaTypes: CortexNodeType[];
  /** Mapa cortexId → nodeRedId já construído (cresce durante compilação) */
  cortexToNrId: Record<string, string>;
  /** Contexto de compilação (flowToken, apiBase, credentials) */
  context: CompileContext;
}
