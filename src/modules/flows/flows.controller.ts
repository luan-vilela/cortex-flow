import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { FlowsService } from "./flows.service";
import {
  CreateFlowDto,
  UpdateFlowDto,
  ExecuteFlowDto,
  SaveNodesDto,
  ImportFlowDto,
} from "./dto/flow.dto";
import { WorkspaceMemberGuard } from "../../common/guards/workspace-member.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequireWorkspaceRole } from "../../common/decorators/workspace-role.decorator";

@ApiTags("flows")
@ApiBearerAuth()
@UseGuards(WorkspaceMemberGuard)
@Controller("workspaces/:workspaceId/flows")
export class FlowsController {
  constructor(private service: FlowsService) {}

  @Post()
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({
    summary: "Criar flow (cria workflow no n8n automaticamente)",
  })
  create(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateFlowDto,
    @CurrentUser() user: any,
  ) {
    return this.service.create(workspaceId, dto, user.sub);
  }

  @Get()
  @ApiOperation({ summary: "Listar flows do workspace" })
  findAll(@Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.service.findAll(workspaceId);
  }

  @Get(":flowId")
  @ApiOperation({ summary: "Detalhes do flow" })
  findOne(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.findOne(workspaceId, flowId);
  }

  @Patch(":flowId")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({ summary: "Atualizar flow" })
  update(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
    @Body() dto: UpdateFlowDto,
  ) {
    return this.service.update(workspaceId, flowId, dto);
  }

  @Delete(":flowId")
  @RequireWorkspaceRole("admin")
  @ApiOperation({ summary: "Excluir flow (remove do n8n também)" })
  delete(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.delete(workspaceId, flowId);
  }

  @Post(":flowId/activate")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({ summary: "Ativar flow" })
  activate(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.activate(workspaceId, flowId);
  }

  @Post(":flowId/deactivate")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({ summary: "Desativar flow" })
  deactivate(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.deactivate(workspaceId, flowId);
  }

  @Post(":flowId/execute")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({ summary: "Executar flow manualmente" })
  execute(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
    @Body() dto: ExecuteFlowDto,
    @CurrentUser() user: any,
  ) {
    return this.service.execute(workspaceId, flowId, dto, user.sub);
  }

  @Post(":flowId/test")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({
    summary: "Testar flow (síncrono, retorna resultado imediato)",
  })
  testFlow(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
    @Body() body: Record<string, any>,
  ) {
    // Aceita { inputData: {...} } ou diretamente { campo: valor, ... }
    const inputData =
      body && "inputData" in body ? body.inputData : (body ?? {});
    return this.service.testFlow(workspaceId, flowId, inputData);
  }

  @Post(":flowId/duplicate")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({ summary: "Duplicar flow" })
  duplicate(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.duplicate(workspaceId, flowId, user.sub);
  }

  @Get(":flowId/editor-url")
  @ApiOperation({ summary: "Obter URL do editor n8n para este flow" })
  editorUrl(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.getEditorUrl(workspaceId, flowId);
  }

  @Post(":flowId/sync")
  @RequireWorkspaceRole("admin")
  @ApiOperation({ summary: "Sincronizar estado com Node-RED" })
  sync(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.syncFromNodeRed(workspaceId, flowId);
  }

  @Patch(":flowId/nodes")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({
    summary: "Salvar grafo visual do editor (nodes + edges) e sincronizar n8n",
  })
  saveNodes(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
    @Body() dto: SaveNodesDto,
  ) {
    return this.service.saveNodes(workspaceId, flowId, dto);
  }

  @Get(":flowId/webhook-info")
  @ApiOperation({
    summary: "Retorna URLs de disparo webhook do flow (teste e produção)",
  })
  getWebhookInfo(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.getWebhookInfo(workspaceId, flowId);
  }

  @Get(":flowId/export")
  @ApiOperation({
    summary: "Exportar flow como JSON portável (sem IDs internos)",
  })
  exportFlow(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.exportFlow(workspaceId, flowId);
  }

  @Post("import")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({
    summary:
      "Importar flow a partir de JSON exportado (cria novo flow no workspace)",
  })
  importFlow(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() dto: ImportFlowDto,
    @CurrentUser() user: any,
  ) {
    return this.service.importFlow(workspaceId, dto, user.sub);
  }
}
