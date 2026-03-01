import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Workspace } from "./workspace.entity";
import { User } from "../../auth/entities/user.entity";

@Entity("workspace_members")
export class WorkspaceMember {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Workspace, { eager: false })
  @JoinColumn({ name: "workspace_id" })
  workspace: Workspace;

  @Column({ name: "workspace_id" })
  workspaceId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "user_id" })
  userId: string;

  @Column({ default: "operator" })
  role: "admin" | "operator" | "viewer";

  @Column({ name: "invited_by", nullable: true })
  invitedBy: string;

  @CreateDateColumn({ name: "joined_at" })
  joinedAt: Date;
}
