import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Flow } from "../flows/entities/flow.entity";
import { Execution } from "../executions/entities/execution.entity";
import { ExecutionsService } from "../executions/executions.service";
import { NodeRedBridgeService } from "../node-red-bridge/node-red-bridge.service";

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Flow)
    private flowRepo: Repository<Flow>,
    @InjectRepository(Execution)
    private executionRepo: Repository<Execution>,
    private executionsService: ExecutionsService,
    private nodeRedBridge: NodeRedBridgeService,
  ) {}

  // ── Trigger externo via webhook token ─────────────────────
  async triggerByToken(
    webhookToken: string,
    payload: any,
    headers: Record<string, string>,
  ): Promise<{ executionId: string; message: string }> {
    const flow = await this.flowRepo.findOne({ where: { webhookToken } });
    if (!flow) throw new NotFoundException("Webhook não encontrado");
    if (flow.status !== "active") {
      throw new ForbiddenException("Flow inativo, não pode ser disparado");
    }
    if (!flow.webhookToken) {
      throw new ForbiddenException("Flow não tem webhook configurado");
    }

    // Cria execução
    const execution = await this.executionRepo.save(
      this.executionRepo.create({
        flowId: flow.id,
        workspaceId: flow.workspaceId,
        status: "queued",
        triggeredBy: "webhook",
        inputData: { payload, headers: this.sanitizeHeaders(headers) },
        startedAt: new Date(),
      }),
    );

    // Dispara no Node-RED via webhook interno
    try {
      await this.nodeRedBridge.triggerWebhook(flow.webhookToken, {
        executionId: execution.id,
        payload,
        headers: this.sanitizeHeaders(headers),
      });
      await this.executionRepo.update(execution.id, { status: "running" });
    } catch (e) {
      this.logger.error(`Erro ao disparar flow via Node-RED: ${e.message}`);
      await this.executionRepo.update(execution.id, {
        status: "error",
        errorMessage: e.message,
        finishedAt: new Date(),
      });
    }

    return {
      executionId: execution.id,
      message: "Flow disparado com sucesso",
    };
  }

  // ── Callback interno do Node-RED (resultado de execução) ───
  async handleNodeRedCallback(body: {
    executionId?: string;
    status: "success" | "error";
    data?: any;
    error?: string;
  }) {
    this.logger.log(`Node-RED callback: ${JSON.stringify(body)}`);

    if (body.executionId) {
      await this.executionsService.handleNodeRedCallback(
        body.executionId,
        body.status,
        body.data,
        body.error,
      );
    }

    return { received: true };
  }

  // Remove headers sensíveis antes de persistir
  private sanitizeHeaders(
    headers: Record<string, string>,
  ): Record<string, string> {
    const sensitive = ["authorization", "cookie", "x-api-key"];
    return Object.fromEntries(
      Object.entries(headers).filter(
        ([k]) => !sensitive.includes(k.toLowerCase()),
      ),
    );
  }
}
