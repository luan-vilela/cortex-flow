import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("bulk_executions")
export class BulkExecution {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "integration_id", type: "uuid" })
  integrationId: string;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId: string;

  @Column({ name: "total_recipients", type: "int", default: 0 })
  totalRecipients: number;

  @Column({ type: "int", default: 0 })
  accepted: number;

  @Column({ type: "int", default: 0 })
  delivered: number;

  @Column({ type: "int", default: 0 })
  failed: number;

  @Column({ type: "varchar", length: 20, default: "processing" })
  status: "processing" | "done" | "partial";

  @CreateDateColumn({ name: "triggered_at" })
  triggeredAt: Date;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt: Date | null;
}
