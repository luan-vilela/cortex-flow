import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Flow } from "../../flows/entities/flow.entity";
import { Workspace } from "../../workspaces/entities/workspace.entity";
import { User } from "../../auth/entities/user.entity";

@Entity("executions")
export class Execution {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Flow, { eager: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "flow_id" })
  flow: Flow;

  @Column({ name: "flow_id" })
  flowId: string;

  @ManyToOne(() => Workspace, { eager: false })
  @JoinColumn({ name: "workspace_id" })
  workspace: Workspace;

  @Column({ name: "workspace_id" })
  workspaceId: string;

  @Column({ name: "n8n_execution_id", nullable: true })
  n8nExecutionId: string;

  @Column({ default: "queued" })
  status: "queued" | "running" | "success" | "error" | "canceled";

  @Column({ name: "triggered_by", default: "manual" })
  triggeredBy: "manual" | "webhook" | "schedule" | "sso_user";

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: "triggered_by_user_id" })
  triggeredByUser: User;

  @Column({ name: "triggered_by_user_id", nullable: true })
  triggeredByUserId: string;

  @Column({ name: "input_data", type: "jsonb", default: "{}" })
  inputData: Record<string, any>;

  @Column({ name: "output_data", type: "jsonb", nullable: true })
  outputData: Record<string, any>;

  @Column({ name: "error_message", nullable: true })
  errorMessage: string;

  @Column({ name: "error_details", type: "jsonb", nullable: true })
  errorDetails: Record<string, any>;

  @Column({ name: "started_at" })
  startedAt: Date;

  @Column({ name: "finished_at", nullable: true })
  finishedAt: Date;

  @Column({ name: "duration_ms", nullable: true })
  durationMs: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
