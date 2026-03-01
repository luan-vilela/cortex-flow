import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Workspace } from "../../workspaces/entities/workspace.entity";

@Entity("gmail_credentials")
export class GmailCredential {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Workspace, { eager: false })
  @JoinColumn({ name: "workspace_id" })
  workspace: Workspace;

  @Column({ name: "workspace_id" })
  workspaceId: string;

  /** E-mail do usuário conectado (ex: usuario@gmail.com) */
  @Column()
  email: string;

  /** Nome de exibição (ex: "João Silva") */
  @Column({ name: "display_name", nullable: true })
  displayName: string;

  /** ID da credencial criada no n8n (legado, mantido por compatibilidade) */
  @Column({ name: "n8n_credential_id", nullable: true })
  n8nCredentialId: string;

  /** Access token OAuth2 do Google */
  @Column({ name: "access_token", type: "text", nullable: true })
  accessToken: string;

  /** Refresh token OAuth2 do Google (longa duração) */
  @Column({ name: "refresh_token", type: "text", nullable: true })
  refreshToken: string;

  /** Timestamp de expiração do access token atual */
  @Column({ name: "token_expires_at", type: "timestamptz", nullable: true })
  tokenExpiresAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
