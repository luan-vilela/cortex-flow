import { Module, Global } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WorkspaceMemberGuard } from "./guards/workspace-member.guard";
import { WorkspaceMember } from "../modules/workspaces/entities/workspace-member.entity";
import { AuthModule } from "../modules/auth/auth.module";

@Global()
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([WorkspaceMember])],
  providers: [WorkspaceMemberGuard],
  exports: [WorkspaceMemberGuard, AuthModule, TypeOrmModule],
})
export class CommonModule {}
