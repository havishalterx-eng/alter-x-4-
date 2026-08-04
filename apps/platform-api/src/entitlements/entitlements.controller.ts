import { Controller, Get, Inject } from "@nestjs/common";
import { ActorContext, RequireTenantRole } from "../rbac/decorators";
import type { ActorContext as Actor } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import {
  ENTITLEMENT_PROVIDER,
  type EntitlementProvider,
} from "./entitlement-provider.interface";
import type { EffectiveEntitlement } from "./types";

@Controller("/api/v1/entitlements")
@RequireTenantRole("member")
export class EntitlementsController {
  constructor(
    @Inject(ENTITLEMENT_PROVIDER)
    private readonly entitlements: EntitlementProvider,
  ) {}

  @Get()
  get(@ActorContext() actor?: Actor): Promise<EffectiveEntitlement> {
    return this.entitlements.getEffectiveEntitlement(
      requireActor(actor).tenant_id,
    );
  }
}

function requireActor(actor: Actor | undefined): Actor {
  if (!actor) {
    throw new PlatformHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
      "/api/v1/entitlements",
    );
  }
  return actor;
}
