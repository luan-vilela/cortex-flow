import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { WorkspaceMember } from "../../modules/workspaces/entities/workspace-member.entity";
import { Reflector } from "@nestjs/core";

export const REQUIRED_ROLES_KEY = "workspace_roles";

@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  constructor(
    @InjectRepository(WorkspaceMember)
    private memberRepo: Repository<WorkspaceMember>,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const workspaceId = request.params.workspaceId;

    if (!workspaceId) return true;

    const requiredRoles = this.reflector.get<string[]>(
      REQUIRED_ROLES_KEY,
      context.getHandler(),
    ) || ["viewer", "operator", "admin"];

    const member = await this.memberRepo.findOne({
      where: { workspaceId, userId: user.sub },
    });

    if (!member) {
      throw new ForbiddenException("Você não tem acesso a este workspace");
    }

    if (!requiredRoles.includes(member.role)) {
      throw new ForbiddenException(
        `Permissão insuficiente. Necessário: ${requiredRoles.join(" ou ")}`,
      );
    }

    request.workspaceMember = member;
    return true;
  }
}
