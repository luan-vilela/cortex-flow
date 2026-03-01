import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Execution } from "./entities/execution.entity";
import { Logger } from "@nestjs/common";

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    @InjectRepository(Execution)
    private executionRepo: Repository<Execution>,
  ) {}

  async findAll(workspaceId: string, flowId?: string, limit = 50, offset = 0) {
    const query = this.executionRepo
      .createQueryBuilder("e")
      .where("e.workspace_id = :workspaceId", { workspaceId })
      .orderBy("e.started_at", "DESC")
      .limit(limit)
      .offset(offset);

    if (flowId) {
      query.andWhere("e.flow_id = :flowId", { flowId });
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, limit, offset };
  }

  async findOne(workspaceId: string, executionId: string): Promise<Execution> {
    const exec = await this.executionRepo.findOne({
      where: { id: executionId, workspaceId },
    });
    if (!exec) throw new NotFoundException("Execução não encontrada");
    return exec;
  }

  async cancel(workspaceId: string, executionId: string): Promise<Execution> {
    const exec = await this.findOne(workspaceId, executionId);
    await this.executionRepo.update(exec.id, {
      status: "canceled",
      finishedAt: new Date(),
    });
    return this.findOne(workspaceId, executionId);
  }

  async reExecute(
    workspaceId: string,
    executionId: string,
  ): Promise<Execution> {
    const original = await this.findOne(workspaceId, executionId);

    return this.executionRepo.save(
      this.executionRepo.create({
        flowId: original.flowId,
        workspaceId,
        status: "queued",
        triggeredBy: "manual",
        triggeredByUserId: original.triggeredByUserId,
        inputData: original.inputData,
        startedAt: new Date(),
      }),
    );
  }

  // ── Callback do Node-RED (chamado pelo WebhooksService) ────
  async handleNodeRedCallback(
    executionId: string,
    status: "success" | "error",
    outputData?: any,
    errorMessage?: string,
  ) {
    const exec = await this.executionRepo.findOne({
      where: { id: executionId },
    });
    if (!exec) return;

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - exec.startedAt.getTime();

    await this.executionRepo.update(exec.id, {
      status,
      outputData,
      errorMessage,
      finishedAt,
      durationMs,
    });
  }

  async getStats(workspaceId: string, flowId?: string) {
    const query = this.executionRepo
      .createQueryBuilder("e")
      .select("e.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("e.workspace_id = :workspaceId", { workspaceId })
      .groupBy("e.status");

    if (flowId) query.andWhere("e.flow_id = :flowId", { flowId });

    const rows = await query.getRawMany();
    const stats = { success: 0, error: 0, running: 0, queued: 0, canceled: 0 };
    rows.forEach((r) => {
      if (r.status in stats) stats[r.status] = parseInt(r.count);
    });
    return stats;
  }
}
