import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  BadRequestException,
} from "@nestjs/common";
import { Response } from "express";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CredentialsService } from "./credentials.service";
import { WorkspaceMemberGuard } from "../../common/guards/workspace-member.guard";
import { RequireWorkspaceRole } from "../../common/decorators/workspace-role.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { ConfigService } from "@nestjs/config";

// ── Workspace-scoped routes (/workspaces/:workspaceId/credentials/*) ─────────

@ApiTags("credentials")
@ApiBearerAuth()
@UseGuards(WorkspaceMemberGuard)
@Controller("workspaces/:workspaceId/credentials")
export class CredentialsController {
  constructor(
    private service: CredentialsService,
    private config: ConfigService,
  ) {}

  // ── Gmail ──────────────────────────────────────────────────────────────

  @Post("gmail/connect")
  @ApiOperation({ summary: "Inicia fluxo OAuth2 do Gmail" })
  gmailConnect(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query("flowId") flowId: string,
    @Query("nodeId") nodeId: string,
  ) {
    if (!flowId || !nodeId)
      throw new BadRequestException("flowId e nodeId são obrigatórios");
    const authUrl = this.service.buildGoogleAuthUrl(
      workspaceId,
      flowId,
      nodeId,
    );
    return { authUrl };
  }

  @Get("gmail")
  @ApiOperation({ summary: "Listar contas Gmail conectadas" })
  listGmail(@Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.service.listGmailCredentials(workspaceId);
  }

  @Delete("gmail/:credId")
  @RequireWorkspaceRole("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Desconectar conta Gmail" })
  deleteGmail(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("credId", ParseUUIDPipe) credId: string,
  ) {
    return this.service.deleteGmailCredential(workspaceId, credId);
  }
}

// ── Public OAuth callback (/credentials/gmail/callback) ──────────────────────

@ApiTags("credentials")
@Controller("credentials/gmail")
export class GmailCallbackController {
  constructor(
    private service: CredentialsService,
    private config: ConfigService,
  ) {}

  @Public()
  @Get("callback")
  @ApiOperation({ summary: "Callback OAuth2 do Gmail (público)" })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Res() res: Response,
  ) {
    const frontendUrl =
      this.config.get<string>("FRONTEND_URL") || "http://localhost:3003";

    if (error || !code) {
      return res.redirect(
        `${frontendUrl}/oauth/error?message=${encodeURIComponent(error || "código ausente")}`,
      );
    }

    try {
      const { credential, workspaceId, flowId, nodeId } =
        await this.service.handleOAuthCallback(code, state);

      return res.redirect(
        `${frontendUrl}/workspaces/${workspaceId}/flows/${flowId}/editor` +
          `?gmailCredId=${credential.id}` +
          `&gmailEmail=${encodeURIComponent(credential.email)}` +
          `&gmailNodeId=${encodeURIComponent(nodeId)}`,
      );
    } catch (e) {
      return res.redirect(
        `${frontendUrl}/oauth/error?message=${encodeURIComponent(e.message)}`,
      );
    }
  }
}

// ── Internal endpoint (Node-RED → Cortex Flow API, sem auth JWT) ─────────────

@ApiTags("internal")
@Controller("flows/internal/credentials/gmail")
export class InternalCredentialsController {
  constructor(private service: CredentialsService) {}

  /**
   * Retorna um access token válido para o Gmail.
   * Chamado pelos function nodes dentro do Node-RED via rede interna Docker.
   * Não requer JWT — disponível apenas na rede interna do container.
   */
  @Public()
  @Get(":credId/token")
  @ApiOperation({ summary: "Obter token Gmail válido (interno Node-RED)" })
  async getToken(
    @Param("credId", ParseUUIDPipe) credId: string,
  ): Promise<{ accessToken: string }> {
    const accessToken = await this.service.getValidAccessToken(credId);
    return { accessToken };
  }
}

// ── Workspace-scoped routes (/workspaces/:workspaceId/credentials/*) ─────────
