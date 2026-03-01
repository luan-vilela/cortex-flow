import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Generated,
} from "typeorm";

export type IntegrationChannel = "email" | "whatsapp" | "custom";
export type IntegrationStatus = "active" | "paused" | "draft";

@Entity("integrations")
export class Integration {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId: string;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ name: "template_slug", type: "varchar", length: 100 })
  templateSlug: string;

  @Column({ type: "varchar", length: 50, default: "email" })
  channel: IntegrationChannel;

  @Column({ name: "credential_id", type: "uuid", nullable: true })
  credentialId: string | null;

  @Column({ name: "default_vars", type: "jsonb", default: {} })
  defaultVars: Record<string, any>;

  @Column({ name: "webhook_token", type: "uuid", unique: true })
  @Generated("uuid")
  webhookToken: string;

  @Column({
    name: "node_red_flow_id",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  nodeRedFlowId: string | null;

  @Column({ type: "varchar", length: 20, default: "active" })
  status: IntegrationStatus;

  @Column({ name: "created_by", type: "uuid" })
  createdBy: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
