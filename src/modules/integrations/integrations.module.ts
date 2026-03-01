import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Integration } from "./entities/integration.entity";
import { BulkExecution } from "./entities/bulk-execution.entity";
import { IntegrationsService } from "./integrations.service";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsTriggerController } from "./integrations-trigger.controller";
import { NodeRedBridgeModule } from "../node-red-bridge/node-red-bridge.module";
import { PlansModule } from "../plans/plans.module";
import { FlowTemplate } from "../templates/entities/flow-template.entity";
import { GmailCredential } from "../credentials/entities/gmail-credential.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Integration,
      BulkExecution,
      FlowTemplate,
      GmailCredential,
    ]),
    NodeRedBridgeModule,
    PlansModule,
  ],
  providers: [IntegrationsService],
  controllers: [IntegrationsController, IntegrationsTriggerController],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
