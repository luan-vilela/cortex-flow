import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";

export interface NodeRedFlowDefinition {
  id?: string;
  label: string;
  disabled?: boolean;
  info?: string;
  env?: Array<{ name: string; value: string; type: string }>;
  nodes: NodeRedNode[];
  configs?: NodeRedNode[];
  /** Credenciais por nó — { nodeId: { userid, password, ... } } */
  credentials?: Record<string, Record<string, string>>;
}

export interface NodeRedNode {
  id: string;
  type: string;
  z?: string;
  name?: string;
  x?: number;
  y?: number;
  wires?: string[][];
  [key: string]: any;
}

@Injectable()
export class NodeRedBridgeService {
  private readonly logger = new Logger(NodeRedBridgeService.name);
  private client: AxiosInstance;
  private cachedToken: string | null = null;

  constructor(private config: ConfigService) {
    const baseUrl =
      this.config.get<string>("NODERED_BASE_URL") || "http://node-red:1880";
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        "Content-Type": "application/json",
        "Node-RED-API-Version": "v2",
      },
      timeout: 10000,
    });

    // Interceptor: adiciona token Bearer em todas as requisições admin
    this.client.interceptors.request.use(async (req) => {
      // Rotas de auth e webhooks não precisam de token
      if (req.url?.startsWith("/auth") || req.url?.startsWith("/webhook")) {
        return req;
      }
      const token = await this.getAdminToken();
      if (token) {
        req.headers["Authorization"] = `Bearer ${token}`;
      }
      return req;
    });

    // Interceptor: em 401 limpa o token em cache e lança
    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          this.cachedToken = null;
        }
        return Promise.reject(err);
      },
    );
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private async getAdminToken(): Promise<string | null> {
    if (this.cachedToken) return this.cachedToken;

    const user = this.config.get<string>("NODERED_ADMIN_USER") || "admin";
    const pass = this.config.get<string>("NODERED_ADMIN_PASS");

    if (!pass) return null; // sem senha configurada, Node-RED provavelmente sem auth

    try {
      const res = await this.client.post("/auth/token", {
        client_id: "node-red-admin",
        grant_type: "password",
        username: user,
        password: pass,
        scope: "*",
      });
      this.cachedToken = res.data.access_token;
      this.logger.debug("Token Node-RED obtido com sucesso");
      return this.cachedToken;
    } catch (e) {
      this.logger.warn(`Falha ao autenticar no Node-RED: ${e.message}`);
      return null;
    }
  }

  // ── Health ────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      // GET /auth/login retorna 200 sem auth — prova que Node-RED está no ar
      const baseUrl =
        this.config.get<string>("NODERED_BASE_URL") || "http://node-red:1880";
      await axios.get(`${baseUrl}/auth/login`, { timeout: 5000 });

      // Se credenciais configuradas, valida o token admin também
      const pass = this.config.get<string>("NODERED_ADMIN_PASS");
      if (pass) {
        const token = await this.getAdminToken();
        return !!token;
      }

      // Sem credenciais configuradas: Node-RED acessível = conectado
      return true;
    } catch {
      return false;
    }
  }

  // ── Flows (Tabs) ──────────────────────────────────────────────────────────

  /**
   * Cria um novo flow (tab) no Node-RED.
   * Retorna o ID gerado pelo Node-RED.
   */
  async createFlow(
    definition: NodeRedFlowDefinition,
  ): Promise<{ nodeRedFlowId: string }> {
    const res = await this.client.post("/flow", definition);
    const nodeRedFlowId = String(res.data?.id || res.data);
    this.logger.debug(`Flow criado no Node-RED: ${nodeRedFlowId}`);
    return { nodeRedFlowId };
  }

  /**
   * Atualiza um flow existente (substitui completamente).
   */
  async updateFlow(
    nodeRedFlowId: string,
    definition: NodeRedFlowDefinition,
  ): Promise<void> {
    await this.client.put(`/flow/${nodeRedFlowId}`, {
      ...definition,
      id: nodeRedFlowId,
    });
    this.logger.debug(`Flow atualizado no Node-RED: ${nodeRedFlowId}`);
  }

  /**
   * Lê o flow atual do Node-RED.
   */
  async getFlow(nodeRedFlowId: string): Promise<NodeRedFlowDefinition> {
    const res = await this.client.get(`/flow/${nodeRedFlowId}`);
    return res.data;
  }

  /**
   * Remove um flow do Node-RED.
   */
  async deleteFlow(nodeRedFlowId: string): Promise<void> {
    await this.client.delete(`/flow/${nodeRedFlowId}`);
    this.logger.debug(`Flow removido do Node-RED: ${nodeRedFlowId}`);
  }

  /**
   * Habilita ou desabilita um flow (ativar/desativar).
   */
  async setFlowEnabled(nodeRedFlowId: string, enabled: boolean): Promise<void> {
    let current: NodeRedFlowDefinition;
    try {
      current = await this.getFlow(nodeRedFlowId);
    } catch (e) {
      throw new Error(`Flow ${nodeRedFlowId} não encontrado no Node-RED`);
    }
    await this.updateFlow(nodeRedFlowId, {
      ...current,
      disabled: !enabled,
    });
    this.logger.debug(
      `Flow ${nodeRedFlowId} ${enabled ? "habilitado" : "desabilitado"} no Node-RED`,
    );
  }

  // ── Nodes (npm packages) ──────────────────────────────────────────────────

  /**
   * Instala um pacote npm como node no Node-RED.
   * Ex: installNode("node-red-node-email")
   */
  async installNode(module: string): Promise<void> {
    await this.client.post("/nodes", { module });
    this.logger.log(`Node instalado no Node-RED: ${module}`);
  }

  /**
   * Lista todos os nodes instalados.
   */
  async listNodes(): Promise<any[]> {
    const res = await this.client.get("/nodes");
    return res.data;
  }

  // ── Util ──────────────────────────────────────────────────────────────────

  getBaseUrl(): string {
    return (
      this.config.get<string>("NODERED_BASE_URL") || "http://node-red:1880"
    );
  }

  /**
   * URL pública de webhook para um flow (acessível externamente via porta 5679).
   */
  getWebhookUrl(flowToken: string, type: "test" | "prod" = "prod"): string {
    const publicBase =
      this.config.get<string>("PUBLIC_WEBHOOK_BASE_URL") ||
      "http://localhost:5679";
    return `${publicBase}/webhook/${flowToken}`;
  }

  /**
   * Dispara um flow no Node-RED via webhook interno.
   * @param token Token do webhook HTTP-in node configurado no flow
   * @param payload Dados a enviar para o flow
   */
  async triggerWebhook(token: string, payload: any): Promise<void> {
    await this.client.post(`/webhook/${token}`, payload);
    this.logger.log(`Flow disparado via webhook Node-RED: ${token}`);
  }
}
