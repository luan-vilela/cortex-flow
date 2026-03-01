import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from "typeorm";

@Entity("workspace_usage")
@Unique(["workspaceId", "period"])
export class WorkspaceUsage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId: string;

  @Column({ type: "char", length: 7 })
  period: string; // 'YYYY-MM'

  @Column({ name: "emails_sent", type: "int", default: 0 })
  emailsSent: number;

  @Column({ name: "whatsapp_sent", type: "int", default: 0 })
  whatsappSent: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
