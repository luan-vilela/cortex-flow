import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FlowsService } from "./flows.service";
import { FlowsController } from "./flows.controller";
import { FlowCompilerService } from "./flow-compiler.service";
import { Flow } from "./entities/flow.entity";
import { Execution } from "../executions/entities/execution.entity";
import { NodeRedBridgeModule } from "../node-red-bridge/node-red-bridge.module";
import { CredentialsModule } from "../credentials/credentials.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Flow, Execution]),
    NodeRedBridgeModule,
    CredentialsModule,
  ],
  providers: [FlowsService, FlowCompilerService],
  controllers: [FlowsController],
  exports: [FlowsService, FlowCompilerService, TypeOrmModule],
})
export class FlowsModule {}
