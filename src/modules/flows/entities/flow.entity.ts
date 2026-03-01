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
import { User } from "../../auth/entities/user.entity";

@Entity("flows")
export class Flow {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Workspace, { eager: false })
  @JoinColumn({ name: "workspace_id" })
  workspace: Workspace;

  @Column({ name: "workspace_id" })
  workspaceId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  // n8n refs
  @Column({ name: "n8n_workflow_id", nullable: true })
  n8nWorkflowId: string;

  @Column({ name: "n8n_tag_id", nullable: true })
  n8nTagId: string;

  // State
  @Column({ default: "draft" })
  status: "draft" | "active" | "inactive";

  @Column({ name: "trigger_type", default: "manual" })
  triggerType: "manual" | "webhook" | "cron" | "event";

  @Column({ name: "webhook_token", type: "uuid", nullable: true, unique: true })
  webhookToken: string;

  @Column({ name: "cron_expression", nullable: true })
  cronExpression: string;

  @Column({ type: "text", array: true, default: "{}" })
  tags: string[];

  @Column({ nullable: true })
  icon: string;

  @Column({ nullable: true })
  color: string;

  // Visual editor (React Flow graph)
  @Column({ type: "jsonb", default: [] })
  nodes: object[];

  @Column({ type: "jsonb", default: [] })
  edges: object[];

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: "created_by" })
  createdByUser: User;

  @Column({ name: "created_by" })
  createdBy: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
