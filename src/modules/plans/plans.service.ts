import { Injectable, ForbiddenException, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Plan } from "./entities/plan.entity";
import { WorkspaceUsage } from "./entities/workspace-usage.entity";
import { Workspace } from "../workspaces/entities/workspace.entity";

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    @InjectRepository(Plan)
    private planRepo: Repository<Plan>,
    @InjectRepository(WorkspaceUsage)
    private usageRepo: Repository<WorkspaceUsage>,
    @InjectRepository(Workspace)
    private workspaceRepo: Repository<Workspace>,
  ) {}

  private currentPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  async getWorkspacePlan(workspaceId: string): Promise<Plan> {
    const ws = await this.workspaceRepo.findOne({ where: { id: workspaceId } });
    if (!ws || !ws["planId"]) {
      return this.planRepo.findOne({ where: { slug: "free" } });
    }
    return this.planRepo.findOne({ where: { id: ws["planId"] } });
  }

  async getUsage(
    workspaceId: string,
    period?: string,
  ): Promise<WorkspaceUsage> {
    const p = period ?? this.currentPeriod();
    let usage = await this.usageRepo.findOne({
      where: { workspaceId, period: p },
    });
    if (!usage) {
      usage = this.usageRepo.create({
        workspaceId,
        period: p,
        emailsSent: 0,
        whatsappSent: 0,
      });
      await this.usageRepo.save(usage);
    }
    return usage;
  }

  /**
   * Verifica cota e incrementa atomicamente.
   * Lança ForbiddenException se o workspace estiver acima do limite.
   */
  async checkAndIncrement(
    workspaceId: string,
    channel: "email" | "whatsapp",
    quantity: number,
  ): Promise<{ remaining: number }> {
    const plan = await this.getWorkspacePlan(workspaceId);
    const usage = await this.getUsage(workspaceId);
    const period = this.currentPeriod();

    if (channel === "email") {
      if (usage.emailsSent + quantity > plan.emailLimit) {
        throw new ForbiddenException(
          `Limite de emails atingido. Plano ${plan.name}: ${plan.emailLimit}/mês. Enviados: ${usage.emailsSent}.`,
        );
      }
      await this.usageRepo.increment(
        { workspaceId, period },
        "emails_sent",
        quantity,
      );
      return { remaining: plan.emailLimit - usage.emailsSent - quantity };
    }

    if (channel === "whatsapp") {
      if (plan.whatsappLimit === 0) {
        throw new ForbiddenException(
          `Seu plano ${plan.name} não inclui envios de WhatsApp.`,
        );
      }
      if (usage.whatsappSent + quantity > plan.whatsappLimit) {
        throw new ForbiddenException(
          `Limite de WhatsApp atingido. Plano ${plan.name}: ${plan.whatsappLimit}/mês.`,
        );
      }
      await this.usageRepo.increment(
        { workspaceId, period },
        "whatsapp_sent",
        quantity,
      );
      return { remaining: plan.whatsappLimit - usage.whatsappSent - quantity };
    }

    return { remaining: -1 };
  }

  async getPlanSummary(workspaceId: string) {
    const plan = await this.getWorkspacePlan(workspaceId);
    const usage = await this.getUsage(workspaceId);
    return {
      plan: { id: plan.id, name: plan.name, slug: plan.slug },
      limits: {
        email: plan.emailLimit,
        whatsapp: plan.whatsappLimit,
        aiEnabled: plan.aiEnabled,
      },
      used: { email: usage.emailsSent, whatsapp: usage.whatsappSent },
      remaining: {
        email: Math.max(0, plan.emailLimit - usage.emailsSent),
        whatsapp: Math.max(0, plan.whatsappLimit - usage.whatsappSent),
      },
      period: usage.period,
    };
  }

  async listPlans(): Promise<Plan[]> {
    return this.planRepo.find({
      where: { active: true },
      order: { priceCents: "ASC" },
    });
  }
}
