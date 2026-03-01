import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { ExecutionsService } from "./executions.service";
import { WorkspaceMemberGuard } from "../../common/guards/workspace-member.guard";
import { RequireWorkspaceRole } from "../../common/decorators/workspace-role.decorator";

@ApiTags("executions")
@ApiBearerAuth()
@UseGuards(WorkspaceMemberGuard)
@Controller("workspaces/:workspaceId")
export class ExecutionsController {
  constructor(private service: ExecutionsService) {}

  @Get("executions")
  @ApiOperation({ summary: "Listar todas as execuções do workspace" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  findAll(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    return this.service.findAll(workspaceId, undefined, limit, offset);
  }

  @Get("flows/:flowId/executions")
  @ApiOperation({ summary: "Listar execuções de um flow específico" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  findByFlow(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    return this.service.findAll(workspaceId, flowId, limit, offset);
  }

  @Get("flows/:flowId/executions/stats")
  @ApiOperation({ summary: "Estatísticas de execuções do flow" })
  stats(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("flowId", ParseUUIDPipe) flowId: string,
  ) {
    return this.service.getStats(workspaceId, flowId);
  }

  @Get("flows/:flowId/executions/:executionId")
  @ApiOperation({ summary: "Detalhes de uma execução" })
  findOne(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
  ) {
    return this.service.findOne(workspaceId, executionId);
  }

  @Post("flows/:flowId/executions/:executionId/cancel")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({ summary: "Cancelar execução em andamento" })
  cancel(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
  ) {
    return this.service.cancel(workspaceId, executionId);
  }

  @Post("flows/:flowId/executions/:executionId/re-execute")
  @RequireWorkspaceRole("admin", "operator")
  @ApiOperation({ summary: "Re-executar com mesmo payload" })
  reExecute(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
  ) {
    return this.service.reExecute(workspaceId, executionId);
  }
}
