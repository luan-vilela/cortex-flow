import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WebhooksService } from "./webhooks.service";
import { WebhooksController } from "./webhooks.controller";
import { Flow } from "../flows/entities/flow.entity";
import { Execution } from "../executions/entities/execution.entity";
import { ExecutionsModule } from "../executions/executions.module";
import { NodeRedBridgeModule } from "../node-red-bridge/node-red-bridge.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Flow, Execution]),
    ExecutionsModule,
    NodeRedBridgeModule,
  ],
  providers: [WebhooksService],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
