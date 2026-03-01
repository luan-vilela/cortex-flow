import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { TemplatesService } from "./templates.service";
import { InstallTemplateDto } from "./dto/install-template.dto";
import { WorkspaceMemberGuard } from "../../common/guards/workspace-member.guard";
import { RequireWorkspaceRole } from "../../common/decorators/workspace-role.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";

@ApiTags("templates")
@ApiBearerAuth()
@Controller("templates")
export class TemplatesPublicController {
  constructor(private service: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: "Listar todos os templates disponíveis" })
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe de um template" })
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post("seed")
  @Public()
  @ApiOperation({ summary: "Seed dos templates padrão (desenvolvimento)" })
  async seed() {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("Não disponível em produção");
    }
    await this.service.seedDefaults();
    return { message: "Templates padrão inseridos/atualizados com sucesso" };
  }
}

@ApiTags("templates")
@ApiBearerAuth()
@UseGuards(WorkspaceMemberGuard)
@Controller("workspaces/:workspaceId/flows")
export class TemplatesInstallController {
  constructor(private service: TemplatesService) {}

  @Post("from-template")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({
    summary: "Instalar template — substitui placeholders e cria flow no n8n",
  })
  install(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() dto: InstallTemplateDto,
    @CurrentUser() user: any,
  ) {
    return this.service.install(workspaceId, dto, user.sub);
  }

  @Post(":flowId/apply-template")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({
    summary:
      "Aplica um template a um flow existente — vincula workflow no n8n ao flow",
  })
  applyToFlow(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
    @Body() dto: InstallTemplateDto,
    @CurrentUser() user: any,
  ) {
    return this.service.applyToFlow(workspaceId, flowId, dto, user.sub);
  }
}
