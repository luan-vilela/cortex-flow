import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";

@Entity("workspaces")
export class Workspace {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: "owner_id" })
  owner: User;

  @Column({ name: "owner_id" })
  ownerId: string;

  // Cortex Control integration (optional)
  @Column({ name: "crm_workspace_id", nullable: true })
  crmWorkspaceId: number;

  @Column({ name: "crm_api_url", nullable: true })
  crmApiUrl: string;

  @Column({ name: "crm_api_key", nullable: true, select: false })
  crmApiKey: string;

  // n8n config (per-workspace or global fallback)
  @Column({ name: "n8n_base_url", nullable: true })
  n8nBaseUrl: string;

  @Column({ name: "n8n_api_key", nullable: true, select: false })
  n8nApiKey: string;

  @Column({ name: "n8n_tag_id", nullable: true })
  n8nTagId: string;

  @Column({ type: "jsonb", default: "{}" })
  settings: Record<string, any>;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
