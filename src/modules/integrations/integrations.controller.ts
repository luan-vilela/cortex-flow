import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { IntegrationsService } from "./integrations.service";
import { CreateIntegrationDto } from "./dto/create-integration.dto";
import { UpdateIntegrationDto } from "./dto/update-integration.dto";
import { PlansService } from "../plans/plans.service";

@ApiTags("integrations")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/integrations")
export class IntegrationsController {
  constructor(
    private readonly service: IntegrationsService,
    private readonly plans: PlansService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Listar integrações do workspace" })
  list(@Param("workspaceId") workspaceId: string) {
    return this.service.list(workspaceId);
  }

  @Get("usage")
  @ApiOperation({ summary: "Resumo de uso e limites do plano" })
  usage(@Param("workspaceId") workspaceId: string) {
    return this.plans.getPlanSummary(workspaceId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe de uma integração" })
  findOne(@Param("workspaceId") workspaceId: string, @Param("id") id: string) {
    return this.service.findOne(workspaceId, id);
  }

  @Get(":id/executions")
  @ApiOperation({ summary: "Histórico de envios em lote desta integração" })
  executions(@Param("id") id: string) {
    return this.service.listBulkExecutions(id);
  }

  @Post()
  @ApiOperation({ summary: "Instalar um template como integração ativa" })
  create(
    @Param("workspaceId") workspaceId: string,
    @Req() req: any,
    @Body() dto: CreateIntegrationDto,
  ) {
    return this.service.create(workspaceId, req.user.userId, dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Atualizar configuração ou pausar/ativar integração",
  })
  update(
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Body() dto: UpdateIntegrationDto,
  ) {
    return this.service.update(workspaceId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remover integração e flow do Node-RED" })
  remove(@Param("workspaceId") workspaceId: string, @Param("id") id: string) {
    return this.service.remove(workspaceId, id);
  }
}
