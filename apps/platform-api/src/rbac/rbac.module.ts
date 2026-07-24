import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import { RbacExceptionFilter } from "./rbac-exception.filter";
import { RbacGuard } from "./rbac.guard";
import { RequestParamTenantResolver } from "./resource-tenant.resolver";

export const resourceTenantResolverToken = Symbol("ResourceTenantResolver");

@Module({
  providers: [
    {
      provide: resourceTenantResolverToken,
      useValue: new RequestParamTenantResolver(),
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
