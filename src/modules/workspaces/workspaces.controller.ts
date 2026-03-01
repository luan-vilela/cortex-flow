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
import { WorkspacesService } from "./workspaces.service";
import {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  LinkCrmDto,
  ConfigureN8nDto,
  InviteMemberDto,
} from "./dto/workspace.dto";
import { WorkspaceMemberGuard } from "../../common/guards/workspace-member.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequireWorkspaceRole } from "../../common/decorators/workspace-role.decorator";

@ApiTags("workspaces")
@ApiBearerAuth()
@Controller("workspaces")
export class WorkspacesController {
  constructor(private service: WorkspacesService) {}

  @Post()
  @ApiOperation({ summary: "Criar workspace" })
  create(@Body() dto: CreateWorkspaceDto, @CurrentUser() user: any) {
    return this.service.create(dto, user.sub);
  }

  @Get()
  @ApiOperation({ summary: "Listar meus workspaces" })
  findAll(@CurrentUser() user: any) {
    return this.service.findAllForUser(user.sub);
  }

  @Get(":workspaceId")
  @UseGuards(WorkspaceMemberGuard)
  @ApiOperation({ summary: "Detalhes do workspace" })
  findOne(@Param("workspaceId", ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(":workspaceId")
  @UseGuards(WorkspaceMemberGuard)
  @RequireWorkspaceRole("admin")
  @ApiOperation({ summary: "Atualizar workspace" })
  update(
    @Param("workspaceId", ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(":workspaceId")
  @UseGuards(WorkspaceMemberGuard)
  @RequireWorkspaceRole("admin")
  @ApiOperation({ summary: "Excluir workspace" })
  delete(
    @Param("workspaceId", ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.service.delete(id, user.sub);
  }

  // ── CRM Integration ──────────────────────────────────────
  @Patch(":workspaceId/crm-link")
  @UseGuards(WorkspaceMemberGuard)
  @RequireWorkspaceRole("admin")
  @ApiOperation({ summary: "Vincular ao Cortex Control" })
  linkCrm(
    @Param("workspaceId", ParseUUIDPipe) id: string,
    @Body() dto: LinkCrmDto,
  ) {
    return this.service.linkCrm(id, dto);
  }

  @Get(":workspaceId/crm/status")
  @UseGuards(WorkspaceMemberGuard)
  @ApiOperation({ summary: "Status da conexão com o CRM" })
  crmStatus(@Param("workspaceId", ParseUUIDPipe) id: string) {
    return this.service.getCrmStatus(id);
  }

  // ── n8n Config ────────────────────────────────────────────
  @Patch(":workspaceId/n8n")
  @UseGuards(WorkspaceMemberGuard)
  @RequireWorkspaceRole("admin")
  @ApiOperation({ summary: "Configurar conexão n8n do workspace" })
  configureN8n(
    @Param("workspaceId", ParseUUIDPipe) id: string,
    @Body() dto: ConfigureN8nDto,
  ) {
    return this.service.configureN8n(id, dto);
  }

  @Get(":workspaceId/n8n/status")
  @UseGuards(WorkspaceMemberGuard)
  @ApiOperation({ summary: "Status da conexão n8n" })
  n8nStatus(@Param("workspaceId", ParseUUIDPipe) id: string) {
    return this.service.getN8nStatus(id);
  }

  // ── Members ───────────────────────────────────────────────
  @Get(":workspaceId/members")
  @UseGuards(WorkspaceMemberGuard)
  @ApiOperation({ summary: "Listar membros do workspace" })
  getMembers(@Param("workspaceId", ParseUUIDPipe) id: string) {
    return this.service.getMembers(id);
  }

  @Post(":workspaceId/members")
  @UseGuards(WorkspaceMemberGuard)
  @RequireWorkspaceRole("admin")
  @ApiOperation({ summary: "Convidar membro" })
  inviteMember(
    @Param("workspaceId", ParseUUIDPipe) id: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: any,
  ) {
    return this.service.inviteMember(id, dto, user.sub);
  }

  @Delete(":workspaceId/members/:memberId")
  @UseGuards(WorkspaceMemberGuard)
  @RequireWorkspaceRole("admin")
  @ApiOperation({ summary: "Remover membro" })
  removeMember(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("memberId", ParseUUIDPipe) memberId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removeMember(workspaceId, memberId, user.sub);
  }
}
