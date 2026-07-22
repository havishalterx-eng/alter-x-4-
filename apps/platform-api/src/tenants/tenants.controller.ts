import { Controller, Get, Param } from "@nestjs/common";
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
