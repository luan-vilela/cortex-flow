import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { N8nBridgeService } from "./n8n-bridge.service";
import { Workspace } from "../workspaces/entities/workspace.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Workspace])],
  providers: [N8nBridgeService],
  exports: [N8nBridgeService],
})
export class N8nBridgeModule {}
