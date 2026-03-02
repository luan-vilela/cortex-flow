import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import axios from "axios";
import { Flow } from "./entities/flow.entity";
import { Execution } from "../executions/entities/execution.entity";
import {
  CreateFlowDto,
  UpdateFlowDto,
  ExecuteFlowDto,
  SaveNodesDto,
  ImportFlowDto,
} from "./dto/flow.dto";
import { NodeRedBridgeService } from "../node-red-bridge/node-red-bridge.service";
import { CredentialsService } from "../credentials/credentials.service";
import {
  FlowCompilerService,
  CortexNode,
  CortexEdge,
} from "./flow-compiler.service";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class FlowsService {
  private readonly logger = new Logger(FlowsService.name);

  constructor(
    @InjectRepository(Flow)
    private flowRepo: Repository<Flow>,
    @InjectRepository(Execution)
    private executionRepo: Repository<Execution>,
    private nodeRedBridge: NodeRedBridgeService,
    private credentialsService: CredentialsService,
    private flowCompiler: FlowCompilerService,
  ) {}

  async create(
    workspaceId: string,
    dto: CreateFlowDto,
    userId: string,
  ): Promise<Flow> {
    const webhookToken = uuidv4();
    let nodeRedFlowId: string | null = null;

    // Cria o flow no Node-RED com definição vazia
    try {
      const emptyDef = this.flowCompiler.compile([], [], dto.name, {
        flowToken: webhookToken,
      });
      const result = await this.nodeRedBridge.createFlow(emptyDef);
      nodeRedFlowId = result.nodeRedFlowId;
    } catch (e) {
      this.logger.warn(
        `Node-RED indisponível, flow criado sem link: ${e.message}`,
      );
    }

    const flow = this.flowRepo.create({
      workspaceId,
      name: dto.name,
      description: dto.description,
      triggerType: dto.triggerType || "manual",
      cronExpression: dto.cronExpression,
      tags: dto.tags || [],
      icon: dto.icon,
      color: dto.color,
      status: "draft",
      n8nWorkflowId: nodeRedFlowId, // reusa coluna para armazenar Node-RED ID
      webhookToken,
      createdBy: userId,
    });

    return this.flowRepo.save(flow);
  }

  async findAll(workspaceId: string): Promise<Flow[]> {
    return this.flowRepo.find({
      where: { workspaceId },
      order: { createdAt: "DESC" },
    });
  }

  async findOne(workspaceId: string, flowId: string): Promise<Flow> {
    const flow = await this.flowRepo.findOne({
      where: { id: flowId, workspaceId },
    });
    if (!flow) throw new NotFoundException("Flow não encontrado");
    return flow;
  }

  async update(
    workspaceId: string,
    flowId: string,
    dto: UpdateFlowDto,
  ): Promise<Flow> {
    const flow = await this.findOne(workspaceId, flowId);

    // Atualiza label no Node-RED se necessário
    if (dto.name && flow.n8nWorkflowId) {
      try {
        const current = await this.nodeRedBridge.getFlow(flow.n8nWorkflowId);
        await this.nodeRedBridge.updateFlow(flow.n8nWorkflowId, {
          ...current,
          label: dto.name,
        });
      } catch (e) {
        this.logger.warn(
          `Não foi possível atualizar nome no Node-RED: ${e.message}`,
        );
      }
    }

    await this.flowRepo.update(
      { id: flowId, workspaceId },
      {
        name: dto.name,
        description: dto.description,
        triggerType: dto.triggerType,
        cronExpression: dto.cronExpression,
        tags: dto.tags,
        icon: dto.icon,
        color: dto.color,
        ...(dto.nodes !== undefined ? { nodes: dto.nodes } : {}),
        ...(dto.edges !== undefined ? { edges: dto.edges } : {}),
      },
    );

    return this.findOne(workspaceId, flowId);
  }

  async activate(workspaceId: string, flowId: string): Promise<Flow> {
    const flow = await this.findOne(workspaceId, flowId);
    if (!flow.n8nWorkflowId) {
      throw new BadRequestException(
        "Flow não está sincronizado com o Node-RED",
      );
    }
    await this.nodeRedBridge.setFlowEnabled(flow.n8nWorkflowId, true);
    await this.flowRepo.update({ id: flowId }, { status: "active" });
    return this.findOne(workspaceId, flowId);
  }

  async deactivate(workspaceId: string, flowId: string): Promise<Flow> {
    const flow = await this.findOne(workspaceId, flowId);
    if (flow.n8nWorkflowId) {
      try {
        await this.nodeRedBridge.setFlowEnabled(flow.n8nWorkflowId, false);
      } catch (e) {
        this.logger.warn(`Erro ao desativar no Node-RED: ${e.message}`);
      }
    }
    await this.flowRepo.update({ id: flowId }, { status: "inactive" });
    return this.findOne(workspaceId, flowId);
  }

  async execute(
    workspaceId: string,
    flowId: string,
    dto: ExecuteFlowDto,
    userId: string,
  ): Promise<Execution> {
    const flow = await this.findOne(workspaceId, flowId);

    // Cria registro de execução
    const execution = await this.executionRepo.save(
      this.executionRepo.create({
        flowId,
        workspaceId,
        status: "queued",
        triggeredBy: "manual",
        triggeredByUserId: userId,
        inputData: dto.inputData || {},
        startedAt: new Date(),
      }),
    );

    // Dispara no Node-RED via POST no webhook do flow
    const webhookUrl = this.nodeRedBridge.getWebhookUrl(
      flow.webhookToken,
      "prod",
    );

    axios
      .post(webhookUrl, dto.inputData || {})
      .then(() => {
        return this.executionRepo.update(execution.id, {
          status: "success",
          finishedAt: new Date(),
        });
      })
      .catch(async (e) => {
        this.logger.error(`Erro ao executar flow ${flowId}: ${e.message}`);
        await this.executionRepo.update(execution.id, {
          status: "error",
          errorMessage: e.message,
          finishedAt: new Date(),
        });
      });

    return execution;
  }

  /**
   * Executa o flow de forma síncrona e retorna o resultado imediato do Node-RED.
   * Usado pelo botão "Testar" no editor.
   */
  async testFlow(
    workspaceId: string,
    flowId: string,
    inputData?: object,
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    enableUrl?: string;
  }> {
    const flow = await this.findOne(workspaceId, flowId);

    const webhookUrl = this.nodeRedBridge.getWebhookUrl(
      flow.webhookToken,
      "prod",
    );

    try {
      const res = await axios.post(webhookUrl, inputData || {}, {
        timeout: 30_000,
        validateStatus: () => true, // não lançar exceção em 4xx/5xx
      });

      const body =
        typeof res.data === "string"
          ? (() => {
              try {
                return JSON.parse(res.data);
              } catch {
                return { raw: res.data };
              }
            })()
          : res.data;

      if (res.status >= 400) {
        const error: string = body?.error ?? JSON.stringify(body);
        const enableUrl: string | undefined = body?.enableUrl;
        return { success: false, error, enableUrl };
      }

      return { success: true, data: body };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async delete(workspaceId: string, flowId: string): Promise<void> {
    const flow = await this.findOne(workspaceId, flowId);
    if (flow.n8nWorkflowId) {
      try {
        await this.nodeRedBridge.deleteFlow(flow.n8nWorkflowId);
      } catch (e) {
        this.logger.warn(`Erro ao remover flow no Node-RED: ${e.message}`);
      }
    }
    await this.flowRepo.delete({ id: flowId, workspaceId });
  }

  async duplicate(
    workspaceId: string,
    flowId: string,
    userId: string,
  ): Promise<Flow> {
    const flow = await this.findOne(workspaceId, flowId);

    return this.create(
      workspaceId,
      {
        name: `${flow.name} (cópia)`,
        description: flow.description,
        triggerType: flow.triggerType,
        cronExpression: flow.cronExpression,
        tags: flow.tags,
        icon: flow.icon,
        color: flow.color,
      },
      userId,
    );
  }

  // ── Export / Import ──────────────────────────────────────────────────────────

  /**
   * Exporta um flow como JSON portável (sem IDs internos, sem credenciais).
   */
  async exportFlow(
    workspaceId: string,
    flowId: string,
  ): Promise<{
    cortexFlowVersion: string;
    exportedAt: string;
    flow: object;
  }> {
    const flow = await this.findOne(workspaceId, flowId);

    return {
      cortexFlowVersion: "1.0",
      exportedAt: new Date().toISOString(),
      flow: {
        name: flow.name,
        description: flow.description,
        triggerType: flow.triggerType,
        cronExpression: flow.cronExpression,
        tags: flow.tags ?? [],
        icon: flow.icon,
        color: flow.color,
        nodes: flow.nodes ?? [],
        edges: flow.edges ?? [],
      },
    };
  }

  /**
   * Importa um flow a partir de um JSON exportado por `exportFlow`.
   * Cria um novo flow (nunca sobrescreve) e sincroniza com o Node-RED.
   */
  async importFlow(
    workspaceId: string,
    dto: ImportFlowDto,
    userId: string,
  ): Promise<Flow> {
    const payload = dto.flow;

    // Cria o flow base (sem nodes ainda — create só registra metadata)
    const newFlow = await this.create(
      workspaceId,
      {
        name: payload.name,
        description: payload.description,
        triggerType: payload.triggerType ?? "manual",
        cronExpression: payload.cronExpression,
        tags: payload.tags,
        icon: payload.icon,
        color: payload.color,
      },
      userId,
    );

    // Se veio com nodes, persiste e sincroniza com Node-RED
    if (payload.nodes && payload.nodes.length > 0) {
      return this.saveNodes(workspaceId, newFlow.id, {
        nodes: payload.nodes,
        edges: payload.edges ?? [],
      });
    }

    return newFlow;
  }

  /**
   * Salva o grafo visual (nodes + edges) e sincroniza o flow no Node-RED.
   * Chamado pelo editor a cada "Salvar".
   */
  async saveNodes(
    workspaceId: string,
    flowId: string,
    dto: SaveNodesDto,
  ): Promise<Flow> {
    const flow = await this.findOne(workspaceId, flowId);

    // Detecta o triggerType do nó de gatilho para manter a entidade sincronizada
    const triggerNode = (dto.nodes as CortexNode[]).find(
      (n) => n.type === "triggerNode",
    );
    const detectedTriggerType =
      (triggerNode?.data?.triggerType as string) || "manual";

    // Persiste o grafo + triggerType no banco
    await this.flowRepo.update(
      { id: flowId, workspaceId },
      {
        nodes: dto.nodes,
        edges: dto.edges,
        triggerType: detectedTriggerType as Flow["triggerType"],
      },
    );

    // Compila para Node-RED e sincroniza
    try {
      // Resolve credentials para emailConnectionNodes
      const gmailCredMap = await this.buildGmailCredMap(
        dto.nodes as CortexNode[],
        workspaceId,
      );

      const nrDef = this.flowCompiler.compile(
        dto.nodes as CortexNode[],
        dto.edges as CortexEdge[],
        flow.name,
        {
          flowToken: flow.webhookToken,
          gmailCredentials: gmailCredMap,
        },
      );

      if (flow.n8nWorkflowId) {
        // Atualiza flow existente
        await this.nodeRedBridge.updateFlow(flow.n8nWorkflowId, {
          ...nrDef,
          id: flow.n8nWorkflowId,
        });
      } else {
        // Cria flow no Node-RED pela primeira vez
        const result = await this.nodeRedBridge.createFlow(nrDef);
        await this.flowRepo.update(
          { id: flowId, workspaceId },
          { n8nWorkflowId: result.nodeRedFlowId },
        );
      }
    } catch (e) {
      this.logger.warn(
        `Erro ao compilar/sync Node-RED após saveNodes: ${e.message}`,
      );
    }

    return this.findOne(workspaceId, flowId);
  }

  /**
   * Retorna as informações do webhook de disparo externo do flow.
   */
  async getWebhookInfo(
    workspaceId: string,
    flowId: string,
  ): Promise<{
    hasTrigger: boolean;
    webhookPath?: string;
    method?: string;
    testUrl?: string;
    prodUrl?: string;
    isActive?: boolean;
  }> {
    const flow = await this.findOne(workspaceId, flowId);

    const triggerNode = (flow.nodes as CortexNode[]).find(
      (n) => n.type === "triggerNode",
    );

    if (!triggerNode || triggerNode.data?.triggerType !== "webhook") {
      return { hasTrigger: false };
    }

    const webhookToken = flow.webhookToken;
    const method: string = (triggerNode.data?.httpMethod as string) || "POST";
    const baseUrl = this.nodeRedBridge
      .getBaseUrl()
      .replace("node-red:1880", "localhost:5679");

    return {
      hasTrigger: true,
      webhookPath: webhookToken,
      method: method.toUpperCase(),
      testUrl: `${baseUrl}/webhook/${webhookToken}`,
      prodUrl: `${baseUrl}/webhook/${webhookToken}`,
      isActive: flow.status === "active",
    };
  }

  // ── Compat / legacy ──────────────────────────────────────────────────────────

  /**
   * Retorna URL de administração do Node-RED (substitui editor n8n).
   */
  async getEditorUrl(
    _workspaceId: string,
    _flowId: string,
  ): Promise<{ url: string }> {
    const base = this.nodeRedBridge
      .getBaseUrl()
      .replace("node-red:1880", "localhost:5679");
    return { url: base };
  }

  /**
   * Sincroniza status do flow com o Node-RED (substitui syncFromN8n).
   */
  async syncFromNodeRed(workspaceId: string, flowId: string): Promise<Flow> {
    const flow = await this.findOne(workspaceId, flowId);
    if (!flow.n8nWorkflowId) return flow;

    try {
      const nrFlow = await this.nodeRedBridge.getFlow(flow.n8nWorkflowId);
      const newStatus: Flow["status"] = nrFlow.disabled ? "inactive" : "active";
      await this.flowRepo.update({ id: flowId }, { status: newStatus });
    } catch (e) {
      this.logger.warn(`Erro ao sincronizar com Node-RED: ${e.message}`);
    }
    return this.findOne(workspaceId, flowId);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Retorna mapa { nodeId: gmailCredentialUUID } para emailConnectionNodes,
   * resolvendo a credencial pelo gmailCredentialId armazenado no node data.
   */
  private async buildGmailCredMap(
    nodes: CortexNode[],
    _workspaceId: string,
  ): Promise<Record<string, string>> {
    const map: Record<string, string> = {};
    for (const node of nodes) {
      if (
        node.type === "emailConnectionNode" ||
        node.type === "sendEmailNode"
      ) {
        const credId: string =
          node.data?.gmailCredentialId || node.data?.credentialId || "";
        if (credId) map[node.id] = credId;
      }
    }
    return map;
  }
}
