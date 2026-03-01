import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FlowTemplate } from "./entities/flow-template.entity";
import { InstallTemplateDto } from "./dto/install-template.dto";
import { FlowsService } from "../flows/flows.service";

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(FlowTemplate)
    private templateRepo: Repository<FlowTemplate>,
    private flowsService: FlowsService,
  ) {}

  async findAll(): Promise<FlowTemplate[]> {
    return this.templateRepo.find({
      where: { active: true },
      order: { category: "ASC", name: "ASC" },
    });
  }

  async findOne(id: number): Promise<FlowTemplate> {
    const template = await this.templateRepo.findOne({
      where: { id, active: true },
    });
    if (!template) throw new NotFoundException("Template não encontrado");
    return template;
  }

  /**
   * Substitui placeholders {{KEY}} na definição do template e retorna o objeto
   * n8n resolvido + metadados do template. Não cria nada no banco.
   */
  async buildN8nDefinition(
    templateId: number,
    params: Record<string, string>,
  ): Promise<{ resolvedDefinition: any; template: FlowTemplate }> {
    const template = await this.findOne(templateId);

    const missing = template.parametersSchema
      .filter((p) => p.required && !params[p.key])
      .map((p) => p.key);

    if (missing.length > 0) {
      throw new BadRequestException(
        `Parâmetros obrigatórios não fornecidos: ${missing.join(", ")}`,
      );
    }

    let definitionStr = JSON.stringify(template.n8nDefinition);
    for (const [key, value] of Object.entries(params)) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Escapa o valor para ser seguro dentro de uma string JSON
      // (ex: aspas duplas, backslashes) sem os delimitadores externos
      const jsonSafeValue = JSON.stringify(String(value)).slice(1, -1);
      definitionStr = definitionStr.replace(
        new RegExp(`\\{\\{${escaped}\\}\\}`, "g"),
        jsonSafeValue,
      );
    }

    let resolvedDefinition: any;
    try {
      resolvedDefinition = JSON.parse(definitionStr);
    } catch {
      throw new BadRequestException(
        "Definição do template resultou em JSON inválido após substituição dos parâmetros.",
      );
    }

    return { resolvedDefinition, template };
  }

  /**
   * Aplica um template a um flow existente: cria o workflow no n8n e vincula.
   * Não cria um flow novo — modifica o flow passado por flowId.
   */
  async applyToFlow(
    workspaceId: string,
    flowId: string,
    dto: InstallTemplateDto,
    userId: string,
  ) {
    const { resolvedDefinition, template } = await this.buildN8nDefinition(
      dto.templateId,
      dto.params,
    );

    // Node-RED: atualiza metadata do flow sem vincular definição n8n legada
    return this.flowsService.update(workspaceId, flowId, {
      name: dto.flowName,
      triggerType: template.triggerType as any,
      cronExpression: dto.params["CRON_EXPRESSION"],
    });
  }

  /**
   * Instala um template: substitui placeholders na definição n8n e cria o flow.
   * Placeholders no formato {{KEY}} são substituídos pelos valores em dto.params.
   */
  async install(workspaceId: string, dto: InstallTemplateDto, userId: string) {
    const { resolvedDefinition, template: tpl } = await this.buildN8nDefinition(
      dto.templateId,
      dto.params,
    );

    // Cria o flow usando o FlowsService (que gerencia a criação no n8n)
    const flowName =
      dto.flowName || `${tpl.name} (${new Date().toLocaleDateString("pt-BR")})`;

    return this.flowsService.create(
      workspaceId,
      {
        name: flowName,
        description: tpl.description,
        triggerType: tpl.triggerType as any,
        cronExpression: dto.params["CRON_EXPRESSION"],
        tags: ["template", tpl.category],
        icon: tpl.icon,
        color: tpl.color,
        n8nDefinition: resolvedDefinition,
        // Copia o grafo visual do template para o flow recém-criado
        nodes: (tpl.templateNodes || []) as object[],
        edges: (tpl.templateEdges || []) as object[],
      },
      userId,
    );
  }

  /**
   * Seed de templates padrão (uso em desenvolvimento).
   */
  async seedDefaults(): Promise<void> {
    const templates = [
      {
        name: "Email Blast",
        slug: "email-blast",
        description:
          "Envio em massa via Gmail. Chame o endpoint gatilho com uma lista de destinatários. " +
          "Suporta variáveis dinâmicas como {{name}}, {{company}} no assunto e corpo.",
        category: "email",
        triggerType: "webhook",
        icon: "📨",
        color: "#6366f1",
        parametersSchema: [
          {
            key: "subject",
            label: "Assunto padrão",
            type: "string",
            required: true,
            default: "Olá, {{name}}!",
            description:
              "Assunto do email. Use {{variável}} para personalizar.",
          },
          {
            key: "body",
            label: "Corpo do email (HTML)",
            type: "string",
            required: true,
            default: "<p>Olá <strong>{{name}}</strong>,</p><p>{{message}}</p>",
            description:
              "Corpo em HTML. Use {{variável}} para campos dinâmicos.",
          },
          {
            key: "from_name",
            label: "Nome do remetente",
            type: "string",
            required: false,
            default: "Cortex Flow",
          },
          {
            key: "credentialId",
            label: "Credencial Gmail",
            type: "credential",
            required: true,
            credentialType: "gmail",
            description:
              "Conta Gmail conectada via OAuth2 que enviará os emails.",
          },
        ],
      },
      {
        name: "Agente WhatsApp",
        slug: "whatsapp-agent",
        description:
          "Agente de atendimento via WhatsApp. Conecte sua conta Meta Business " +
          "e configure um assistente de IA para responder clientes automaticamente.",
        category: "whatsapp",
        triggerType: "webhook",
        icon: "💬",
        color: "#25d366",
        parametersSchema: [
          {
            key: "welcome_message",
            label: "Mensagem de boas-vindas",
            type: "string",
            required: true,
            default: "Olá! Como posso ajudar?",
          },
          {
            key: "ai_prompt",
            label: "Instruções do agente (system prompt)",
            type: "string",
            required: false,
            default: "Você é um assistente prestativo. Responda em português.",
            description: "Instrução de comportamento para o agente de IA.",
          },
          {
            key: "credentialId",
            label: "Credencial Meta WhatsApp",
            type: "credential",
            required: true,
            credentialType: "meta_whatsapp",
          },
        ],
      },
      {
        name: "Webhook Personalizado",
        slug: "custom-webhook",
        description:
          "Envie dados para qualquer URL externa. Configure o payload com variáveis dinâmicas " +
          "e dispare para múltiplos destinos via webhook.",
        category: "custom",
        triggerType: "webhook",
        icon: "🔗",
        color: "#f59e0b",
        parametersSchema: [
          {
            key: "url",
            label: "URL de destino",
            type: "string",
            required: true,
            default: "https://api.exemplo.com/webhook",
          },
          {
            key: "method",
            label: "Método HTTP",
            type: "string",
            required: false,
            default: "POST",
          },
          {
            key: "payload_template",
            label: "Template do payload (JSON)",
            type: "json",
            required: false,
            default: '{"email":"{{email}}","name":"{{name}}"}',
            description:
              "JSON com {{variáveis}} que serão substituídas por campos do recipient.",
          },
        ],
      },
      {
        name: "Cobrança Asaas",
        slug: "asaas-charge",
        description:
          "Crie cobranças automaticamente no Asaas para uma lista de clientes. " +
          "Envie boleto ou Pix via webhook trigger.",
        category: "financeiro",
        triggerType: "webhook",
        icon: "💰",
        color: "#10b981",
        parametersSchema: [
          {
            key: "description",
            label: "Descrição da cobrança",
            type: "string",
            required: true,
            default: "Cobrança referente a {{service}}",
          },
          {
            key: "billingType",
            label: "Tipo de cobrança",
            type: "string",
            required: true,
            default: "BOLETO",
          },
          {
            key: "value",
            label: "Valor (R$)",
            type: "string",
            required: true,
            default: "{{value}}",
          },
          {
            key: "dueDate",
            label: "Vencimento (YYYY-MM-DD)",
            type: "string",
            required: true,
            default: "{{dueDate}}",
          },
          {
            key: "asaas_api_key",
            label: "API Key Asaas",
            type: "string",
            required: true,
            description: "Sua chave de API do Asaas (começa com $aas_).",
          },
        ],
      },
      // Template original — mantido para compatibilidade
      {
        name: "Envio de Email",
        slug: "email-single",
        description:
          "Envia um email personalizado via Gmail. Suporta variáveis como {{nome}}, {{email}} e {{empresa}}.",
        category: "email",
        triggerType: "manual",
        icon: "📧",
        color: "#6366f1",
        parametersSchema: [],
        templateNodes: [
          {
            id: "trigger-1",
            type: "triggerNode",
            position: { x: 100, y: 200 },
            data: { triggerType: "manual", label: "Início" },
          },
          {
            id: "email-conn-1",
            type: "emailConnectionNode",
            position: { x: 350, y: 200 },
            data: {
              credentialId: "",
              credentialName: "",
              label: "Conexão Gmail",
            },
          },
          {
            id: "email-body-1",
            type: "emailBodyNode",
            position: { x: 600, y: 200 },
            data: {
              subject: "Olá, {{nome}}!",
              body: "<p>Olá <strong>{{nome}}</strong></p>",
              label: "Corpo do Email",
            },
          },
          {
            id: "send-email-1",
            type: "sendEmailNode",
            position: { x: 850, y: 200 },
            data: {
              toEmail: "{{email}}",
              ccEmail: "",
              bccEmail: "",
              label: "Enviar",
            },
          },
        ],
        templateEdges: [
          { id: "e-trigger-conn", source: "trigger-1", target: "email-conn-1" },
          { id: "e-conn-body", source: "email-conn-1", target: "email-body-1" },
          { id: "e-body-send", source: "email-body-1", target: "send-email-1" },
        ],
      },
    ];

    for (const t of templates) {
      const existing = await this.templateRepo.findOne({
        where: { name: t.name },
      });
      if (!existing) {
        await this.templateRepo.save(
          this.templateRepo.create({
            name: t.name,
            description: t.description,
            category: t.category,
            triggerType: t.triggerType,
            icon: t.icon,
            color: t.color,
            parametersSchema: (t.parametersSchema ?? []) as any,
            n8nDefinition: {},
            templateNodes: (t["templateNodes"] ?? []) as object[],
            templateEdges: (t["templateEdges"] ?? []) as object[],
            active: true,
          }),
        );
      }
    }
  }
}
