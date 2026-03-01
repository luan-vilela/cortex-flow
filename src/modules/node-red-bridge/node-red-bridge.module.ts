import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NodeRedBridgeService } from "./node-red-bridge.service";

@Module({
  imports: [ConfigModule],
  providers: [NodeRedBridgeService],
  exports: [NodeRedBridgeService],
})
export class NodeRedBridgeModule {}
