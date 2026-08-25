import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import {
  permissionsMetadataKey,
  publicRouteMetadataKey,
  tenantRolesMetadataKey,
  workspaceRolesMetadataKey,
  staffRolesMetadataKey,
} from "./rbac.metadata";
import type {
  ActorContext as ActorContextValue,
  RbacRequest,
  StaffActorContext as StaffActorContextValue,
  TenantRole,
  WorkspaceRole,
  StaffRole,
} from "./types";

export const Public = () => SetMetadata(publicRouteMetadataKey, true);

export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(permissionsMetadataKey, permissions);

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
export const StaffActorContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffActorContextValue | undefined => {
    const request = context.switchToHttp().getRequest<RbacRequest>();
    return request.staffActorContext;
  },
);
export const RequireStaffRole = (...roles: StaffRole[]) => SetMetadata(staffRolesMetadataKey, roles);
