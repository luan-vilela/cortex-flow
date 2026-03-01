import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import axios, { AxiosInstance } from "axios";
import { Workspace } from "../workspaces/entities/workspace.entity";

@Injectable()
export class N8nBridgeService {
  private readonly logger = new Logger(N8nBridgeService.name);

  constructor(
    private config: ConfigService,
    @InjectRepository(Workspace)
    private workspaceRepo: Repository<Workspace>,
  ) {}

  // Retorna client axios configurado para o n8n correto
  // Prioridade: configuração do workspace > configuração global
  private async getClient(workspaceId?: string): Promise<AxiosInstance> {
    let baseUrl = this.config.get<string>("N8N_BASE_URL") || "http://n8n:5678";
    let apiKey = this.config.get<string>("N8N_API_KEY") || "";

    if (workspaceId) {
      const ws = await this.workspaceRepo.findOne({
        where: { id: workspaceId },
        select: ["id", "n8nBaseUrl", "n8nApiKey"],
      });
      if (ws?.n8nBaseUrl) baseUrl = ws.n8nBaseUrl;
      if (ws?.n8nApiKey) apiKey = ws.n8nApiKey;
    }

    return axios.create({
      baseURL: `${baseUrl}/api/v1`,
      headers: {
        "X-N8N-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
  }

  // ── Health ────────────────────────────────────────────────
  async healthCheck(n8nUrl?: string, apiKeyOverride?: string) {
    const url =
      n8nUrl || this.config.get<string>("N8N_BASE_URL") || "http://n8n:5678";
    const apiKey =
      apiKeyOverride || this.config.get<string>("N8N_API_KEY") || "";
    const res = await axios.get(`${url}/api/v1/workflows`, {
      headers: { "X-N8N-API-KEY": apiKey },
      timeout: 5000,
    });
    return { status: "ok", n8nUrl: url };
  }

  // ── Tags (workspace isolation) ────────────────────────────
  async ensureWorkspaceTag(
    workspaceId: string,
    workspaceName: string,
  ): Promise<string | null> {
    try {
      const client = await this.getClient(workspaceId);
      const tagName = `cortex:${workspaceId}`;

      // Busca tag existente
      const tagsRes = await client.get("/tags");
      const existing = tagsRes.data?.data?.find((t: any) => t.name === tagName);
      if (existing) return existing.id;

      // Cria tag
      const created = await client.post("/tags", { name: tagName });
      return created.data?.id || null;
    } catch (e) {
      this.logger.warn(`Não foi possível criar tag no n8n: ${e.message}`);
      return null;
    }
  }

  // ── Workflows ─────────────────────────────────────────────
  async createWorkflow(
    workspaceId: string,
    name: string,
    definition?: any,
  ): Promise<{ n8nWorkflowId: string; n8nTagId: string }> {
    const client = await this.getClient(workspaceId);

    // Garante que a tag do workspace existe
    const tagName = `cortex:${workspaceId}`;
    let tagId: string;
    try {
      const tagsRes = await client.get("/tags");
      const existing = tagsRes.data?.data?.find((t: any) => t.name === tagName);
      if (existing) {
        tagId = existing.id;
      } else {
        const created = await client.post("/tags", { name: tagName });
        tagId = created.data?.id;
      }
    } catch (e) {
      this.logger.warn(`Erro ao gerenciar tag: ${e.message}`);
    }

    // Workflow base — sem campo "tags" (é read-only no POST da API pública do n8n)
    const workflowBody = {
      name,
      nodes: definition?.nodes || [
        {
          id: "start",
          name: "Start",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [250, 300],
          parameters: {},
        },
      ],
      connections: definition?.connections || {},
      settings: definition?.settings || { executionOrder: "v1" },
    };

    const res = await client.post("/workflows", workflowBody);
    const workflow = res.data;
    const n8nWorkflowId = String(workflow.id);

    // Adiciona tag via endpoint separado (PUT /workflows/:id/tags)
    if (tagId) {
      try {
        await client.put(`/workflows/${n8nWorkflowId}/tags`, [{ id: tagId }]);
      } catch (e) {
        this.logger.warn(
          `Não foi possível vincular tag ao workflow: ${e.message}`,
        );
      }
    }

    return {
      n8nWorkflowId,
      n8nTagId: tagId || "",
    };
  }

  async activateWorkflow(
    workspaceId: string,
    n8nWorkflowId: string,
  ): Promise<void> {
    const client = await this.getClient(workspaceId);
    await client.patch(`/workflows/${n8nWorkflowId}`, { active: true });
  }

  async deactivateWorkflow(
    workspaceId: string,
    n8nWorkflowId: string,
  ): Promise<void> {
    const client = await this.getClient(workspaceId);
    await client.patch(`/workflows/${n8nWorkflowId}`, { active: false });
  }

  async deleteWorkflow(
    workspaceId: string,
    n8nWorkflowId: string,
  ): Promise<void> {
    const client = await this.getClient(workspaceId);
    await client.delete(`/workflows/${n8nWorkflowId}`);
  }

  async getWorkflow(workspaceId: string, n8nWorkflowId: string): Promise<any> {
    const client = await this.getClient(workspaceId);
    const res = await client.get(`/workflows/${n8nWorkflowId}`);
    return res.data;
  }

  async updateWorkflow(
    workspaceId: string,
    n8nWorkflowId: string,
    definition: any,
  ): Promise<void> {
    const client = await this.getClient(workspaceId);
    await client.put(`/workflows/${n8nWorkflowId}`, definition);
  }

  // ── Executions ────────────────────────────────────────────
  async executeWorkflow(
    workspaceId: string,
    n8nWorkflowId: string,
    inputData?: Record<string, any>,
  ): Promise<{ n8nExecutionId: string }> {
    const client = await this.getClient(workspaceId);

    // Para execução manual, n8n usa POST /workflows/:id/run
    const res = await client.post(`/workflows/${n8nWorkflowId}/run`, {
      startNodes: [],
      runData: inputData || {},
    });

    return {
      n8nExecutionId: String(res.data?.executionId || res.data?.id || ""),
    };
  }

  async getExecution(
    workspaceId: string,
    n8nExecutionId: string,
  ): Promise<any> {
    const client = await this.getClient(workspaceId);
    const res = await client.get(`/executions/${n8nExecutionId}`);
    return res.data;
  }

  async deleteExecution(
    workspaceId: string,
    n8nExecutionId: string,
  ): Promise<void> {
    const client = await this.getClient(workspaceId);
    await client.delete(`/executions/${n8nExecutionId}`);
  }

  async listExecutions(
    workspaceId: string,
    n8nWorkflowId: string,
    limit = 20,
  ): Promise<any[]> {
    const client = await this.getClient(workspaceId);
    const res = await client.get(`/executions`, {
      params: { workflowId: n8nWorkflowId, limit },
    });
    return res.data?.data || [];
  }

  // ── Editor URL ────────────────────────────────────────────
  async getEditorUrl(
    workspaceId: string,
    n8nWorkflowId: string,
  ): Promise<string> {
    const base = await this.getN8nBaseUrl(workspaceId);
    return `${base}/workflow/${n8nWorkflowId}`;
  }

  /**
   * Retorna a URL base do n8n para o workspace (ou a global se não configurado).
   * Usado para construir URLs de webhook sem passar pelo cliente HTTP.
   */
  async getN8nBaseUrl(workspaceId?: string): Promise<string> {
    if (workspaceId) {
      const ws = await this.workspaceRepo.findOne({
        where: { id: workspaceId },
        select: ["n8nBaseUrl"],
      });
      if (ws?.n8nBaseUrl) return ws.n8nBaseUrl;
    }
    return this.config.get<string>("N8N_BASE_URL") || "http://localhost:5678";
  }

  // ── Credentials ───────────────────────────────────────────
  async listCredentials(workspaceId: string): Promise<any[]> {
    // GET /credentials não está disponível na public API desta versão do n8n
    // Retorna lista vazia; o frontend orienta o usuário a buscar o ID no n8n UI
    return [];
  }

  async createCredential(
    workspaceId: string,
    name: string,
    type: string,
    data: Record<string, any>,
  ): Promise<{ n8nCredentialId: string }> {
    const client = await this.getClient(workspaceId);
    const res = await client.post("/credentials", { name, type, data });
    return { n8nCredentialId: String(res.data?.id) };
  }

  async deleteCredential(
    workspaceId: string,
    n8nCredentialId: string,
  ): Promise<void> {
    const client = await this.getClient(workspaceId);
    await client.delete(`/credentials/${n8nCredentialId}`);
  }
}
