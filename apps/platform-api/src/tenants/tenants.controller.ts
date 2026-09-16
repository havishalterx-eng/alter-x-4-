import { Body, Controller, Get, Headers, Param, Put, UseFilters, UseInterceptors } from "@nestjs/common";
import { ConcurrencyExceptionFilter, EtagResponseInterceptor } from "../concurrency";
import { ActorContext, RequireTenantRole } from "../rbac/decorators";
import type { ActorContext as Actor } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import { TenantsService } from "./tenants.service";

@Controller("/api/v1/tenants")
@RequireTenantRole("member")
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list(@ActorContext() actor?: Actor) {
    return this.tenants.list(requireActor(actor));
  }

  @Get(":tenantId")
  get(@ActorContext() actor: Actor | undefined, @Param("tenantId") tenantId: string) {
    return this.tenants.get(requireActor(actor), tenantId);
  }

  @Get(":tenantId/data-residency")
  @UseInterceptors(EtagResponseInterceptor)
  getDataResidency(@ActorContext() actor: Actor | undefined, @Param("tenantId") tenantId: string) {
    return this.tenants.getDataResidency(requireActor(actor), tenantId);
  }

  @Put(":tenantId/data-residency")
  @RequireTenantRole("owner")
  @UseInterceptors(EtagResponseInterceptor)
  @UseFilters(ConcurrencyExceptionFilter)
  setDataResidency(
    @ActorContext() actor: Actor | undefined,
    @Param("tenantId") tenantId: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    return this.tenants.setDataResidency(requireActor(actor), tenantId, body, ifMatch);
  }
}

function requireActor(actor: Actor | undefined): Actor {
  if (!actor) {
    throw new PlatformHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
      "/api/v1/tenants",
    );
  }
  return actor;
}
