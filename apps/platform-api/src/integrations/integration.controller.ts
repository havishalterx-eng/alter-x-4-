import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { EngineResponse } from "../engine";
import { Idempotent } from "../idempotency";
import {
  ActorContext,
  RequirePermission,
  RequireWorkspaceRole,
} from "../rbac";
import type { ActorContextType } from "../rbac";
import { IntegrationExceptionFilter } from "./integration-exception.filter";
import { IntegrationService } from "./integration.service";
import { IntegrationHttpError } from "./problem";
import type { IntegrationPage, IntegrationResource } from "./types";
import {
  parseIntegrationInput,
  parseIntegrationPagination,
} from "./validation";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;
const privilegedRoles = ["admin", "editor"] as const;

@Controller("/api/v1/integrations")
@UseFilters(IntegrationExceptionFilter)
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  @Get()
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("integrations:read")
  async catalog(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<IntegrationPage> {
    const instance = "/api/v1/integrations";
    return project(
      await this.integrations.catalog(
        parseIntegrationPagination(cursor, limit, instance),
        requireActor(actor, instance),
        traceparent,
      ),
      reply,
    );
  }

  @Post()
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("integrations:write")
  @Idempotent()
  async create(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<IntegrationResource> {
    const instance = "/api/v1/integrations";
    return project(
      await this.integrations.create(
        parseIntegrationInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Post(":integrationId/actions/test")
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("integrations:write")
  @Idempotent()
  async test(
    @Param("integrationId") integrationId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<IntegrationResource> {
    const instance =
      `/api/v1/integrations/${integrationId}/actions/test`;
    return project(
      await this.integrations.test(
        integrationId,
        parseIntegrationInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }
}

function requireActor(
  actor: ActorContextType | undefined,
  instance: string,
): ActorContextType {
  if (!actor) {
    throw new IntegrationHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
      instance,
    );
  }
  return actor;
}

function project<T>(response: EngineResponse<T>, reply: FastifyReply): T {
  reply.status(response.status);
  if (response.location) reply.header("Location", response.location);
  if (response.requestId) reply.header("request_id", response.requestId);
  if (response.traceId) reply.header("trace_id", response.traceId);
  return response.body;
}
