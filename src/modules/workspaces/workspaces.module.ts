import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WorkspacesService } from "./workspaces.service";
import { WorkspacesController } from "./workspaces.controller";
import { Workspace } from "./entities/workspace.entity";
import { WorkspaceMember } from "./entities/workspace-member.entity";
import { User } from "../auth/entities/user.entity";
import { N8nBridgeModule } from "../n8n-bridge/n8n-bridge.module";
import { NodeRedBridgeModule } from "../node-red-bridge/node-red-bridge.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Workspace, WorkspaceMember, User]),
    NodeRedBridgeModule,
  ],
  providers: [WorkspacesService],
  controllers: [WorkspacesController],
  exports: [WorkspacesService, TypeOrmModule],
})
export class WorkspacesModule {}
