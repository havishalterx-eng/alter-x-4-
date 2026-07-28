import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  permissionsMetadataKey,
  publicRouteMetadataKey,
} from "../rbac/rbac.metadata";
import { RbacDeniedError, rbacProblem } from "../rbac/problem";
import type { RbacRequest } from "../rbac/types";
import {
  ENTITLEMENT_PROVIDER,
  type EntitlementProvider,
} from "./entitlement-provider.interface";

@Injectable()
export class EntitlementAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ENTITLEMENT_PROVIDER)
    private readonly entitlements: EntitlementProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(
        publicRouteMetadataKey,
        targets,
      )
    ) {
      return true;
    }
    const permissions = this.reflector.getAllAndOverride<string[]>(
      permissionsMetadataKey,
      targets,
    );
    if (!permissions?.some((permission) => !permission.endsWith(":read"))) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RbacRequest>();
    if (!request.actorContext) return true;

    const entitlement = await this.entitlements.getEffectiveEntitlement(
      request.actorContext.tenant_id,
    );
    if (entitlement.accessState === "suspended") {
      throw new RbacDeniedError(
        rbacProblem("RBAC_PERMISSION_DENIED", request.url ?? "unknown"),
      );
    }
    return true;
  }
}
