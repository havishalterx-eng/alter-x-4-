import { Module, type ExecutionContext } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import { SessionGatewayRateLimitGuard } from "@alterx/auth";
import { IdentityModule } from "../identity/identity.module";
import { IdentityService } from "../identity/identity.service";
import { SignupModule } from "../signup/signup.module";
import { PlatformDb } from "../signup/platform-db";
import { ActorContextGuard } from "./actor-context.guard";
import { RbacExceptionFilter } from "./rbac-exception.filter";
import { RbacGuard } from "./rbac.guard";
import { publicRouteMetadataKey } from "./rbac.metadata";
import { RequestParamTenantResolver } from "./resource-tenant.resolver";

export const resourceTenantResolverToken = Symbol("ResourceTenantResolver");

@Module({
  imports: [IdentityModule, SignupModule],
  providers: [
    {
      provide: resourceTenantResolverToken,
      useValue: new RequestParamTenantResolver(),
    },
    {
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
    },
    {
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
    },
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector, resolver: RequestParamTenantResolver) =>
        new RbacGuard(reflector, resolver),
      inject: [Reflector, resourceTenantResolverToken],
    },
    {
      provide: APP_FILTER,
      useClass: RbacExceptionFilter,
    },
  ],
})
export class RbacModule {}
