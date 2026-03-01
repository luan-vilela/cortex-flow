import { SetMetadata } from "@nestjs/common";
import { REQUIRED_ROLES_KEY } from "../guards/workspace-member.guard";

export const RequireWorkspaceRole = (
  ...roles: ("admin" | "operator" | "viewer")[]
) => SetMetadata(REQUIRED_ROLES_KEY, roles);
