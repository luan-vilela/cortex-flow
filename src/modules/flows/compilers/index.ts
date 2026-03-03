/**
 * Barrel export — todos os node compilers.
 *
 * Para adicionar um novo nó, crie `novo-no.compiler.ts` e exporte aqui.
 */
export { compileGmail } from "./gmail.compiler";
export { compileHttpResponse } from "./http-response.compiler";
export { compileHttpRequest } from "./http-request.compiler";
export { compileWait } from "./wait.compiler";
export { compileIf } from "./if.compiler";
export { compileTrigger } from "./trigger.compiler";
export { compileEmail } from "./email.compiler";

// Re-export types for convenience
export type {
  CortexNode,
  CortexNodeType,
  CortexEdge,
  CompileContext,
  EnvVar,
  NodeCompileResult,
  CompilationBag,
  N8nWorkflowDefinition,
} from "./types";
