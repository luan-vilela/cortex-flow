import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { GmailCredential } from "./entities/gmail-credential.entity";

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private config: ConfigService,
    @InjectRepository(GmailCredential)
    private gmailRepo: Repository<GmailCredential>,
  ) {}

  // ── Gmail OAuth2 ──────────────────────────────────────────────────────────

  private get googleClientId(): string {
    const id = this.config.get<string>("GOOGLE_CLIENT_ID");
    if (!id) throw new BadRequestException("GOOGLE_CLIENT_ID não configurado");
    return id;
  }

  private get googleClientSecret(): string {
    const s = this.config.get<string>("GOOGLE_CLIENT_SECRET");
    if (!s)
      throw new BadRequestException("GOOGLE_CLIENT_SECRET não configurado");
    return s;
  }

  /** URL fixa de redirect — precisa estar registrada no Google Cloud Console */
  private get oauthRedirectUri(): string {
    const backendUrl =
      this.config.get<string>("BACKEND_URL") || "http://localhost:3002";
    return `${backendUrl}/credentials/gmail/callback`;
  }

  /**
   * Gera a URL de autorização do Google.
   * state = base64url(JSON({workspaceId, flowId, nodeId}))
   */
  buildGoogleAuthUrl(
    workspaceId: string,
    flowId: string,
    nodeId: string,
  ): string {
    const state = Buffer.from(
      JSON.stringify({ workspaceId, flowId, nodeId }),
    ).toString("base64url");

    const params = new URLSearchParams({
      client_id: this.googleClientId,
      redirect_uri: this.oauthRedirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://mail.google.com/",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ].join(" "),
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Troca o code pelo token, obtém info do usuário e persiste os tokens.
   */
  async handleOAuthCallback(
    code: string,
    state: string,
  ): Promise<{
    credential: GmailCredential;
    workspaceId: string;
    flowId: string;
    nodeId: string;
  }> {
    let workspaceId: string;
    let flowId: string;
    let nodeId: string;
    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString("utf8"),
      );
      workspaceId = decoded.workspaceId;
      flowId = decoded.flowId;
      nodeId = decoded.nodeId;
    } catch {
      throw new BadRequestException("State OAuth inválido");
    }

    // Troca code pelos tokens do Google
    const tokenRes = await axios
      .post<{
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        token_type: string;
      }>(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          code,
          client_id: this.googleClientId,
          client_secret: this.googleClientSecret,
          redirect_uri: this.oauthRedirectUri,
          grant_type: "authorization_code",
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      )
      .catch((e) => {
        const msg = e.response?.data?.error_description || e.message;
        throw new BadRequestException(`Erro ao trocar code pelo token: ${msg}`);
      });

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    if (!refresh_token) {
      throw new BadRequestException(
        "Google não retornou refresh_token. Revogue o acesso em myaccount.google.com e tente novamente.",
      );
    }

    // Obtém informações do usuário autenticado
    const userRes = await axios
      .get<{
        email: string;
        name: string;
      }>("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${access_token}` } })
      .catch(() => ({ data: { email: "desconhecido@gmail.com", name: "" } }));

    const { email, name: displayName } = userRes.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // Salva ou atualiza no banco local
    let credential = await this.gmailRepo.findOne({
      where: { workspaceId, email },
    });

    if (credential) {
      credential.displayName = displayName;
      credential.accessToken = access_token;
      if (refresh_token) credential.refreshToken = refresh_token;
      credential.tokenExpiresAt = tokenExpiresAt;
    } else {
      credential = this.gmailRepo.create({
        workspaceId,
        email,
        displayName,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt,
      });
    }

    await this.gmailRepo.save(credential);
    return { credential, workspaceId, flowId, nodeId };
  }

  /**
   * Retorna um access token válido para a credencial.
   * Usa o refresh token automaticamente se o access token expirou.
   */
  async getValidAccessToken(credentialId: string): Promise<string> {
    const cred = await this.gmailRepo.findOne({ where: { id: credentialId } });
    if (!cred) throw new NotFoundException("Credencial Gmail não encontrada");
    if (!cred.refreshToken) {
      throw new BadRequestException(
        "Credencial sem refresh token. Reconecte a conta Gmail.",
      );
    }

    // Verifica se o token ainda é válido (com 2 min de margem)
    const expiresAt = cred.tokenExpiresAt
      ? new Date(cred.tokenExpiresAt).getTime()
      : 0;
    const now = Date.now();
    const isValid = expiresAt - now > 2 * 60 * 1000;

    if (isValid && cred.accessToken) {
      return cred.accessToken;
    }

    // Refresh via Google
    this.logger.debug(
      `Refreshing access token for Gmail credential ${credentialId}`,
    );
    const res = await axios
      .post<{ access_token: string; expires_in: number }>(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          client_id: this.googleClientId,
          client_secret: this.googleClientSecret,
          refresh_token: cred.refreshToken,
          grant_type: "refresh_token",
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      )
      .catch((e) => {
        const msg = e.response?.data?.error_description || e.message;
        throw new BadRequestException(`Falha ao renovar token Gmail: ${msg}`);
      });

    const newToken = res.data.access_token;
    const newExpiry = new Date(Date.now() + res.data.expires_in * 1000);

    await this.gmailRepo.update(credentialId, {
      accessToken: newToken,
      tokenExpiresAt: newExpiry,
    });

    return newToken;
  }

  async listGmailCredentials(workspaceId: string): Promise<GmailCredential[]> {
    return this.gmailRepo.find({ where: { workspaceId } });
  }

  async deleteGmailCredential(
    workspaceId: string,
    credentialId: string,
  ): Promise<void> {
    const cred = await this.gmailRepo.findOne({
      where: { id: credentialId, workspaceId },
    });
    if (!cred) throw new NotFoundException("Credencial não encontrada");
    await this.gmailRepo.delete({ id: credentialId, workspaceId });
  }
}
