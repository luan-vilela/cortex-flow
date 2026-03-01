import {
  Injectable,
  NotFoundException,
  Logger,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { Integration } from "./entities/integration.entity";
import { BulkExecution } from "./entities/bulk-execution.entity";
import { CreateIntegrationDto } from "./dto/create-integration.dto";
import { UpdateIntegrationDto } from "./dto/update-integration.dto";
import {
  TriggerIntegrationDto,
  RecipientDto,
} from "./dto/trigger-integration.dto";
import { NodeRedBridgeService } from "../node-red-bridge/node-red-bridge.service";
import { PlansService } from "../plans/plans.service";
import { FlowTemplate } from "../templates/entities/flow-template.entity";
import { GmailCredential } from "../credentials/entities/gmail-credential.entity";

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectRepository(Integration)
    private integrationRepo: Repository<Integration>,
    @InjectRepository(BulkExecution)
    private bulkExecRepo: Repository<BulkExecution>,
    @InjectRepository(FlowTemplate)
    private templateRepo: Repository<FlowTemplate>,
    @InjectRepository(GmailCredential)
    private credentialRepo: Repository<GmailCredential>,
    private nodeRedBridge: NodeRedBridgeService,
    private plansService: PlansService,
    private config: ConfigService,
  ) {}

  // ── Listar ─────────────────────────────────────────────────────────────────

  async list(workspaceId: string) {
    const items = await this.integrationRepo.find({
      where: { workspaceId },
      order: { createdAt: "DESC" },
    });
    return items.map((i) => this.formatResponse(i, this.webhookBase()));
  }

  // ── Detalhe ────────────────────────────────────────────────────────────────

  async findOne(workspaceId: string, id: string) {
    const item = await this.integrationRepo.findOne({
      where: { id, workspaceId },
    });
    if (!item) throw new NotFoundException("Integração não encontrada");
    return this.formatResponse(item, this.webhookBase());
  }

  // ── Criar / Instalar template ──────────────────────────────────────────────

  async create(workspaceId: string, userId: string, dto: CreateIntegrationDto) {
    const webhookToken = uuidv4();

    let nodeRedFlowId: string | null = null;
    try {
      const { nodeRedFlowId: nrId } = await this.nodeRedBridge.createFlow({
        label: `int:${dto.name}`,
        disabled: false,
        nodes: [],
      });
      nodeRedFlowId = nrId;
    } catch (e) {
      this.logger.warn(`Node-RED não alocou flow: ${e.message}`);
    }

    const integration = await this.integrationRepo.save(
      this.integrationRepo.create({
        workspaceId,
        createdBy: userId,
        name: dto.name,
        templateSlug: dto.templateSlug,
        channel: dto.channel as any,
        credentialId: dto.credentialId ?? null,
        defaultVars: dto.defaultVars ?? {},
        webhookToken,
        nodeRedFlowId,
        status: "active",
      }),
    );

    return this.formatResponse(integration, this.webhookBase());
  }

  // ── Atualizar ─────────────────────────────────────────────────────────────

  async update(workspaceId: string, id: string, dto: UpdateIntegrationDto) {
    const item = await this.integrationRepo.findOne({
      where: { id, workspaceId },
    });
    if (!item) throw new NotFoundException("Integração não encontrada");
    Object.assign(item, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.credentialId !== undefined
        ? { credentialId: dto.credentialId }
        : {}),
      ...(dto.defaultVars
        ? { defaultVars: { ...item.defaultVars, ...dto.defaultVars } }
        : {}),
    });
    const saved = await this.integrationRepo.save(item);
    return this.formatResponse(saved, this.webhookBase());
  }

  // ── Remover ───────────────────────────────────────────────────────────────

  async remove(workspaceId: string, id: string) {
    const item = await this.integrationRepo.findOne({
      where: { id, workspaceId },
    });
    if (!item) throw new NotFoundException("Integração não encontrada");
    if (item.nodeRedFlowId) {
      await this.nodeRedBridge
        .deleteFlow(item.nodeRedFlowId)
        .catch((e) =>
          this.logger.warn(`Falha ao remover do Node-RED: ${e.message}`),
        );
    }
    await this.integrationRepo.remove(item);
    return { deleted: true };
  }

  // ── Trigger bulk (endpoint público) ───────────────────────────────────────

  async triggerBulk(
    webhookToken: string,
    dto: TriggerIntegrationDto,
  ): Promise<{ accepted: number; batchId: string; remaining: number }> {
    const integration = await this.integrationRepo.findOne({
      where: { webhookToken },
    });
    if (!integration) throw new NotFoundException("Integração não encontrada");
    if (integration.status !== "active") {
      throw new ForbiddenException(
        "Integração pausada, não pode ser disparada",
      );
    }

    const total = dto.recipients.length;
    if (total === 0)
      throw new NotFoundException("Nenhum destinatário fornecido");

    const channel = integration.channel === "whatsapp" ? "whatsapp" : "email";
    const { remaining } = await this.plansService.checkAndIncrement(
      integration.workspaceId,
      channel,
      total,
    );

    const bulk = await this.bulkExecRepo.save(
      this.bulkExecRepo.create({
        integrationId: integration.id,
        workspaceId: integration.workspaceId,
        totalRecipients: total,
        accepted: total,
        status: "processing",
      }),
    );

    // Fan-out assíncrono
    this.processBulk(bulk.id, integration, dto).catch((e) =>
      this.logger.error(`Erro no bulk ${bulk.id}: ${e.message}`),
    );

    return { accepted: total, batchId: bulk.id, remaining };
  }

  // ── Histórico de bulk executions ──────────────────────────────────────────

  async listBulkExecutions(integrationId: string) {
    return this.bulkExecRepo.find({
      where: { integrationId },
      order: { triggeredAt: "DESC" },
      take: 50,
    });
  }

  // ── Processamento assíncrono ──────────────────────────────────────────────

  private async processBulk(
    batchId: string,
    integration: Integration,
    dto: TriggerIntegrationDto,
  ) {
    let delivered = 0;
    let failed = 0;

    let gmailAccessToken: string | null = null;
    if (integration.channel === "email" && integration.credentialId) {
      gmailAccessToken = await this.getValidGmailToken(
        integration.credentialId,
      ).catch(() => null);
    }

    for (const recipient of dto.recipients) {
      try {
        const vars = {
          ...integration.defaultVars,
          ...(dto.vars ?? {}),
          ...recipient,
        };
        if (integration.channel === "email") {
          if (!gmailAccessToken) throw new Error("Token Gmail indisponível");
          await this.sendEmail(gmailAccessToken, recipient, vars);
        } else {
          await this.triggerNodeRedFlow(integration, { recipient, vars });
        }
        delivered++;
      } catch (e) {
        this.logger.warn(
          `Falha ao enviar para ${recipient.email}: ${e.message}`,
        );
        failed++;
      }
    }

    await this.bulkExecRepo.update(batchId, {
      delivered,
      failed,
      status: failed === dto.recipients.length ? "partial" : "done",
      finishedAt: new Date(),
    });
  }

  // ── Gmail send ────────────────────────────────────────────────────────────

  private async sendEmail(
    accessToken: string,
    recipient: RecipientDto,
    vars: Record<string, any>,
  ) {
    const subject = this.resolveVars(
      String(vars.subject ?? "(sem assunto)"),
      vars,
    );
    const body = this.resolveVars(String(vars.body ?? ""), vars);

    const raw = this.buildRawEmail(recipient.email, subject, body);
    await axios.post(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { raw },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }

  private buildRawEmail(to: string, subject: string, body: string): string {
    const mime = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(body).toString("base64"),
    ].join("\r\n");

    return Buffer.from(mime)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  private async triggerNodeRedFlow(integration: Integration, payload: any) {
    if (!integration.nodeRedFlowId) return;
    const base =
      this.config.get<string>("NODERED_BASE_URL") || "http://node-red:1880";
    await axios.post(
      `${base}/integration-exec/${integration.webhookToken}`,
      payload,
    );
  }

  // ── Gmail token refresh ───────────────────────────────────────────────────

  private async getValidGmailToken(credentialId: string): Promise<string> {
    const cred = await this.credentialRepo.findOne({
      where: { id: credentialId },
    });
    if (!cred) throw new Error("Credencial Gmail não encontrada");

    const expiresAt = cred.tokenExpiresAt
      ? new Date(cred.tokenExpiresAt).getTime()
      : 0;
    const isValid = expiresAt - Date.now() > 2 * 60 * 1000;
    if (isValid && cred.accessToken) return cred.accessToken;

    const { data } = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: this.config.get("GOOGLE_CLIENT_ID"),
      client_secret: this.config.get("GOOGLE_CLIENT_SECRET"),
      refresh_token: cred.refreshToken,
      grant_type: "refresh_token",
    });

    cred.accessToken = data.access_token;
    cred.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
    await this.credentialRepo.save(cred);
    return cred.accessToken;
  }

  // ── Utils ─────────────────────────────────────────────────────────────────

  private resolveVars(template: string, vars: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
      vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`,
    );
  }

  private webhookBase(): string {
    return (
      this.config.get<string>("PUBLIC_WEBHOOK_BASE_URL") ||
      "http://localhost:3002"
    );
  }

  private formatResponse(item: Integration, base: string) {
    return {
      ...item,
      triggerUrl: `${base}/integrations/trigger/${item.webhookToken}`,
      examplePayload: {
        recipients: [{ email: "destinatario@exemplo.com", name: "João Silva" }],
        vars: item.defaultVars,
      },
    };
  }
}
