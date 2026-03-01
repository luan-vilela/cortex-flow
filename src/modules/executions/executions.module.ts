import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ExecutionsService } from "./executions.service";
import { ExecutionsController } from "./executions.controller";
import { Execution } from "./entities/execution.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Execution])],
  providers: [ExecutionsService],
  controllers: [ExecutionsController],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
