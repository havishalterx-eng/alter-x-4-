import { Controller, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import { Idempotent } from "../idempotency";
import { ActorContext, RequireWorkspaceRole } from "../rbac";
import type { ActorContextType } from "../rbac";
import { DiscoveryHttpError } from "./problem";
import { DiscoveryService } from "./discovery.service";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;
const writeRoles = ["admin", "editor"] as const;

@Controller("/api/v1/discovery")
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get("recommendations")
  @RequireWorkspaceRole(...readRoles)
  list(
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ) {
    return this.discovery.list(requireActor(actor, "/api/v1/discovery/recommendations"), traceparent);
  }

  @Post("recommendations/:recommendationId/actions/accept")
  @HttpCode(200)
  @RequireWorkspaceRole(...writeRoles)
  @Idempotent()
  accept(
    @Param("recommendationId") recommendationId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.discovery.accept(
      recommendationId,
      requireActor(actor, `/api/v1/discovery/recommendations/${encodeURIComponent(recommendationId)}/actions/accept`),
      traceparent,
      idempotencyKey!,
    );
  }

  @Post("recommendations/:recommendationId/actions/dismiss")
  @HttpCode(204)
  @RequireWorkspaceRole(...writeRoles)
  @Idempotent()
  dismiss(
    @Param("recommendationId") recommendationId: string,
    @ActorContext() actor: ActorContextType | undefined,
  ) {
    return this.discovery.dismiss(
      recommendationId,
      requireActor(actor, `/api/v1/discovery/recommendations/${encodeURIComponent(recommendationId)}/actions/dismiss`),
    );
  }
}

function requireActor(actor: ActorContextType | undefined, instance: string): ActorContextType {
  if (!actor) throw new DiscoveryHttpError(401, "AUTHENTICATION_REQUIRED", "Authenticated actor required", instance);
  return actor;
}
