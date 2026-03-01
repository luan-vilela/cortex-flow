import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FlowTemplate } from "./entities/flow-template.entity";
import { TemplatesService } from "./templates.service";
import {
  TemplatesPublicController,
  TemplatesInstallController,
} from "./templates.controller";
import { FlowsModule } from "../flows/flows.module";

@Module({
  imports: [TypeOrmModule.forFeature([FlowTemplate]), FlowsModule],
  providers: [TemplatesService],
  controllers: [TemplatesPublicController, TemplatesInstallController],
  exports: [TemplatesService],
})
export class TemplatesModule {}
