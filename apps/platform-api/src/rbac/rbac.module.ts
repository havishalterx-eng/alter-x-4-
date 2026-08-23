import { Module, type ExecutionContext } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import { SessionGatewayRateLimitGuard } from "@alterx/auth";
import { EngineClient } from "../engine/engine-client";
import { EngineModule } from "../engine/engine.module";
import { IdentityModule } from "../identity/identity.module";
import { IdentityService } from "../identity/identity.service";
import { SignupModule } from "../signup/signup.module";
import { PlatformDb } from "../signup/platform-db";
import { ActorContextGuard } from "./actor-context.guard";
import {
  defaultWorkspaceResolutionRules,
  ParamWorkspaceResolver,
} from "./param-workspace.resolver";
import { RbacExceptionFilter } from "./rbac-exception.filter";
import { RbacGuard } from "./rbac.guard";
import { publicRouteMetadataKey } from "./rbac.metadata";
import {
  PlatformDbWorkspaceTenantLookup,
  WorkspaceResourceTenantResolver,
} from "./resource-tenant.resolver";

export const resourceTenantResolverToken = Symbol("ResourceTenantResolver");
export const resourceWorkspaceResolverToken = Symbol("ResourceWorkspaceResolver");

const tenantResolverProvider = {
  provide: resourceTenantResolverToken,
  useFactory: (db: PlatformDb) =>
    new WorkspaceResourceTenantResolver(new PlatformDbWorkspaceTenantLookup(db)),
  inject: [PlatformDb],
};

const actorContextGuardProvider = {
  // Registered before RbacGuard -- NestJS runs multiple APP_GUARD
  // providers in registration order, and this is the only reliable way
  // to guarantee actorContext is populated on the same request object
  // RbacGuard reads from (app.useGlobalGuards() was tried first and
  // does NOT share request-object continuity with APP_GUARD providers
  // -- confirmed empirically, not merely per docs). See
  // ActorContextGuard's own doc comment for why this replaced
  // SignupActorContextMiddleware in the first place. Importing
  // IdentityModule/SignupModule here does mean every test that imports
  // RbacModule needs real (dummy) identity/DB env -- see
  // vitest.config.ts's test.env for the single, global place that's
  // satisfied instead of touching every affected spec file.
  provide: APP_GUARD,
  useFactory: (identityService: IdentityService, db: PlatformDb) =>
    new ActorContextGuard(identityService, db),
  inject: [IdentityService, PlatformDb],
};

const rateLimitGuardProvider = {
  // Edge rate limiting must run after ActorContextGuard populated the
  // shared request object, and before RBAC evaluates the protected route.
  // Public and staff-only routes have no tenant actor by design; RBAC owns
  // their decision and this per-tenant limiter must not turn them into 500s.
  provide: APP_GUARD,
  useFactory: (reflector: Reflector) => {
    const rateLimit = new SessionGatewayRateLimitGuard();
    return {
      canActivate: (context: ExecutionContext): boolean => {
        const request = context.switchToHttp().getRequest<{
          readonly actorContext?: { readonly tenant_id: string } | null;
        }>();
        const isPublic = reflector.getAllAndOverride<boolean>(
          publicRouteMetadataKey,
          [context.getHandler(), context.getClass()],
        );
        return isPublic || request.actorContext == null
          ? true
          : rateLimit.canActivate(context);
      },
    };
  },
  inject: [Reflector],
};

const rbacGuardProvider = {
  provide: APP_GUARD,
  useFactory: (
    reflector: Reflector,
    resolver: WorkspaceResourceTenantResolver,
    workspaceResolver: ParamWorkspaceResolver,
  ) => new RbacGuard(reflector, resolver, workspaceResolver),
  inject: [Reflector, resourceTenantResolverToken, resourceWorkspaceResolverToken],
};

const sharedProviders = [
  tenantResolverProvider,
  actorContextGuardProvider,
  rateLimitGuardProvider,
  rbacGuardProvider,
  { provide: APP_FILTER, useClass: RbacExceptionFilter },
];

/**
 * Default RBAC composition (every unit spec): direct workspaceId params are
 * enforced per-workspace, while projectId routes keep the documented legacy
 * flat-role behavior -- the resolver carries no project lookup, so nothing
 * fails closed on environments (specs, local tools) where the Engine is not
 * reachable.
 */
@Module({
  imports: [IdentityModule, SignupModule],
  providers: [
    { provide: resourceWorkspaceResolverToken, useValue: new ParamWorkspaceResolver() },
    ...sharedProviders,
  ],
})
export class RbacModule {}

const enforcingWorkspaceResolverProvider = {
  provide: resourceWorkspaceResolverToken,
  useFactory: (engineClient: EngineClient, db: PlatformDb) =>
    new ParamWorkspaceResolver(
      defaultWorkspaceResolutionRules({ engineClient, db }),
    ),
  inject: [EngineClient, PlatformDb],
};

/**
 * Production composition (ENGINE-FIX-P5-1): additionally binds :projectId
 * routes to their owning workspace through the Engine's tenant-scoped
 * project read (GET /api/v1/projects/:id), so a @RequireWorkspaceRole
 * check requires the role in THAT workspace instead of the actor's
 * any-workspace union. Import INSTEAD OF RbacModule from a composition root
 * that also imports EngineModule (see app.module).
 */
@Module({
  imports: [EngineModule, IdentityModule, SignupModule],
  providers: [
    enforcingWorkspaceResolverProvider,
    ...sharedProviders,
  ],
})
export class EnforcingRbacModule {}
