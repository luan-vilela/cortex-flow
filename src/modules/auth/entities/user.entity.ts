import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: "password_hash", nullable: true })
  passwordHash: string;

  @Column({ name: "avatar_url", nullable: true })
  avatarUrl: string;

  // SSO reference (UUID from Cortex Control)
  @Column({ name: "crm_user_id", nullable: true })
  crmUserId: string;

  @Column({ name: "crm_source", nullable: true })
  crmSource: string;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @Column({ name: "is_verified", default: false })
  isVerified: boolean;

  @Column({ name: "last_login_at", nullable: true })
  lastLoginAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
