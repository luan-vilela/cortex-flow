import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Plan } from "./entities/plan.entity";
import { WorkspaceUsage } from "./entities/workspace-usage.entity";
import { Workspace } from "../workspaces/entities/workspace.entity";
import { PlansService } from "./plans.service";

@Module({
  imports: [TypeOrmModule.forFeature([Plan, WorkspaceUsage, Workspace])],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
