import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UseFilters,
} from "@nestjs/common";
import type {
  RotateWebhookSecretResult,
  TriggerBinding,
  WebhookEndpoint,
} from "@alterx/contracts";
import type { FastifyReply } from "fastify";
import type { EngineResponse } from "../engine";
import { Idempotent } from "../idempotency";
import {
  ActorContext,
  RequirePermission,
  RequireWorkspaceRole,
  type ActorContextType,
} from "../rbac";
import { TriggerExceptionFilter } from "./trigger-exception.filter";
import { TriggerBindingService } from "./trigger-binding.service";
import {
  parseBindingTriggerId,
  parseCreateTriggerBinding,
  parseIntegrationConnectionId,
  parseTriggerBindingId,
} from "./trigger-binding.validation";
import { TriggerHttpError } from "./problem";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;
const writeRoles = ["admin", "editor"] as const;
const privilegedRoles = ["admin"] as const;

@Controller("/api/v1")
@UseFilters(TriggerExceptionFilter)
export class TriggerBindingController {
  constructor(private readonly bindings: TriggerBindingService) {}

  @Post("triggers/:triggerId/bindings")
  @HttpCode(201)
  @RequireWorkspaceRole(...writeRoles)
  @RequirePermission("workflows:write")
  @Idempotent()
  async bind(
    @Param("triggerId") triggerId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TriggerBinding> {
    const instance = `/api/v1/triggers/${triggerId}/bindings`;
    return project(
      await this.bindings.bind(
        parseBindingTriggerId(triggerId, instance),
        parseCreateTriggerBinding(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Get("triggers/:triggerId/bindings")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("workflows:read")
  async list(
    @Param("triggerId") triggerId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ readonly bindings: readonly TriggerBinding[] }> {
    const instance = `/api/v1/triggers/${triggerId}/bindings`;
    return project(
      await this.bindings.list(
        parseBindingTriggerId(triggerId, instance),
        requireActor(actor, instance),
        traceparent,
      ),
      reply,
    );
  }

  @Delete("triggers/:triggerId/bindings/:bindingId")
  @RequireWorkspaceRole(...writeRoles)
  @RequirePermission("workflows:write")
  @Idempotent()
  async disable(
    @Param("triggerId") triggerId: string,
    @Param("bindingId") bindingId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TriggerBinding> {
    const instance = `/api/v1/triggers/${triggerId}/bindings/${bindingId}`;
    return project(
      await this.bindings.disable(
        parseBindingTriggerId(triggerId, instance),
        parseTriggerBindingId(bindingId, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Get("integrations/connections/:integrationId/webhook")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("integrations:read")
  async endpoint(
    @Param("integrationId") integrationId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WebhookEndpoint> {
    const instance = `/api/v1/integrations/connections/${integrationId}/webhook`;
    return project(
      await this.bindings.endpoint(
        parseIntegrationConnectionId(integrationId, instance),
        requireActor(actor, instance),
        traceparent,
      ),
      reply,
    );
  }

  @Post("integrations/connections/:integrationId/webhook/rotate")
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("integrations:write")
  @Idempotent()
  async rotate(
    @Param("integrationId") integrationId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RotateWebhookSecretResult> {
    const instance = `/api/v1/integrations/connections/${integrationId}/webhook/rotate`;
    return project(
      await this.bindings.rotate(
        parseIntegrationConnectionId(integrationId, instance),
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
    throw new TriggerHttpError(
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
  if (response.requestId) reply.header("request_id", response.requestId);
  if (response.traceId) reply.header("trace_id", response.traceId);
  return response.body;
}
