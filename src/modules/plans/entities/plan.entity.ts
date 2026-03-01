import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("plans")
export class Plan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 100 })
  name: string;

  @Column({ type: "varchar", length: 50, unique: true })
  slug: string;

  @Column({ name: "email_limit", type: "int", default: 500 })
  emailLimit: number;

  @Column({ name: "whatsapp_limit", type: "int", default: 0 })
  whatsappLimit: number;

  @Column({ name: "ai_enabled", default: false })
  aiEnabled: boolean;

  @Column({ name: "price_cents", type: "int", default: 0 })
  priceCents: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
