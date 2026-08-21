import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RbacDeniedError, rbacProblem } from "./problem";
import {
  publicRouteMetadataKey,
  tenantRolesMetadataKey,
  workspaceRolesMetadataKey,
  staffRolesMetadataKey,
} from "./rbac.metadata";
import type { ResourceTenantResolver } from "./resource-tenant.resolver";
import type { RbacRequest, StaffRole, TenantRole, WorkspaceRole } from "./types";
import { staffRoleAllows, tenantRoleAllows, workspaceRoleAllows } from "./types";

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resourceTenantResolver: ResourceTenantResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(publicRouteMetadataKey, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const tenantRoles = this.reflector.getAllAndOverride<TenantRole[]>(
      tenantRolesMetadataKey,
      [context.getHandler(), context.getClass()],
    );
    const workspaceRoles = this.reflector.getAllAndOverride<WorkspaceRole[]>(
      workspaceRolesMetadataKey,
      [context.getHandler(), context.getClass()],
    );
    const staffRoles = this.reflector.getAllAndOverride<StaffRole[]>(staffRolesMetadataKey, [context.getHandler(), context.getClass()]);

    const request = context.switchToHttp().getRequest<RbacRequest>();
    const actorContext = request.actorContext;
    if (staffRoles?.length) {
      const staff = request.staffActorContext;
      if (!staff || !staffRoles.some((required) => staff.roles.some((actual) => staffRoleAllows(actual, required)))) throw deny("RBAC_ROLE_DENIED", request.url);
      return true;
    }

    if (!actorContext || (!tenantRoles?.length && !workspaceRoles?.length)) {
      throw deny("RBAC_ROLE_DENIED", request.url);
    }

    const targetTenantId = await this.resourceTenantResolver.resolveTenantId(request);
    if (targetTenantId && actorContext.tenant_id !== targetTenantId) {
      throw deny("RBAC_TENANT_MISMATCH", request.url);
    }

    const hasTenantRole =
      tenantRoles?.some((required) =>
        actorContext.roles.some((actual) => tenantRoleAllows(actual, required)),
      ) ?? false;
    const hasWorkspaceRole =
      workspaceRoles?.some((required) =>
        actorContext.roles.some((actual) => workspaceRoleAllows(actual, required)),
      ) ?? false;

    if (!hasTenantRole && !hasWorkspaceRole) {
      throw deny("RBAC_ROLE_DENIED", request.url);
    }

    return true;
  }
}

function deny(
  errorCode:
    | "RBAC_TENANT_MISMATCH"
    | "RBAC_ROLE_DENIED",
  instance = "unknown",
): RbacDeniedError {
  return new RbacDeniedError(rbacProblem(errorCode, instance));
}
