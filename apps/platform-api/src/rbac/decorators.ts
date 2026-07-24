import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import {
  publicRouteMetadataKey,
  tenantRolesMetadataKey,
  workspaceRolesMetadataKey,
} from "./rbac.metadata";
import type {
  ActorContext as ActorContextValue,
  RbacRequest,
  TenantRole,
  WorkspaceRole,
} from "./types";

export const Public = () => SetMetadata(publicRouteMetadataKey, true);

export const RequireTenantRole = (...roles: TenantRole[]) =>
  SetMetadata(tenantRolesMetadataKey, roles);

export const RequireWorkspaceRole = (...roles: WorkspaceRole[]) =>
  SetMetadata(workspaceRolesMetadataKey, roles);

export const ActorContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActorContextValue | undefined => {
    const request = context.switchToHttp().getRequest<RbacRequest>();
    return request.actorContext;
  },
);
