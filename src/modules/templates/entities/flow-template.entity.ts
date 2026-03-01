import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export interface TemplateParameter {
  key: string;
  label: string;
  type: "string" | "cron" | "json" | "credential";
  required: boolean;
  default?: string;
  description?: string;
  credentialType?: string;
}

@Entity("flow_templates")
export class FlowTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "varchar", length: 100, default: "general" })
  category: string;

  @Column({
    name: "trigger_type",
    type: "varchar",
    length: 50,
    default: "manual",
  })
  triggerType: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  icon?: string;

  @Column({ type: "varchar", length: 20, nullable: true })
  color?: string;

  @Column({ name: "parameters_schema", type: "jsonb", default: [] })
  parametersSchema: TemplateParameter[];

  @Column({ name: "n8n_definition", type: "jsonb", default: {} })
  n8nDefinition: any;

  @Column({ name: "template_nodes", type: "jsonb", default: [] })
  templateNodes: object[];

  @Column({ name: "template_edges", type: "jsonb", default: [] })
  templateEdges: object[];

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
