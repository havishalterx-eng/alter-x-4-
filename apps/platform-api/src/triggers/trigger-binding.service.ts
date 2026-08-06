import { randomBytes } from "node:crypto";
import type {
  CreateTriggerBindingRequest,
  RotateWebhookSecretResult,
  TriggerBinding,
  WebhookEndpoint,
} from "@alterx/contracts";
import type { JsonValue } from "@alterx/shared-clients";
import {
  EngineClient,
  type EngineCallerContext,
  type EngineResponse,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import { TriggerHttpError } from "./problem";
import { parseTraceparent } from "./validation";

export class TriggerBindingService {
  constructor(private readonly engine: EngineClient) {}

  bind(
    triggerId: string,
    input: CreateTriggerBindingRequest,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<TriggerBinding>> {
    const path = `/api/v1/triggers/${encodeURIComponent(triggerId)}/bindings` as const;
    return this.engine.post(
      path,
      input as unknown as JsonValue,
      callerContext(actor, traceparent, path),
      { idempotencyKey },
    );
  }

  list(
    triggerId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<{ readonly bindings: readonly TriggerBinding[] }>> {
    const path = `/api/v1/triggers/${encodeURIComponent(triggerId)}/bindings` as const;
    return this.engine.get(path, callerContext(actor, traceparent, path));
  }

  disable(
    triggerId: string,
    bindingId: string,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<TriggerBinding>> {
    const path = `/api/v1/triggers/${encodeURIComponent(triggerId)}/bindings/${encodeURIComponent(bindingId)}` as const;
    return this.engine.delete(path, callerContext(actor, traceparent, path), {
      idempotencyKey,
    });
  }

  endpoint(
    integrationId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<WebhookEndpoint>> {
    const path = `/api/v1/integrations/${encodeURIComponent(integrationId)}/webhook-endpoint` as const;
    return this.engine.get(path, callerContext(actor, traceparent, path));
  }

  async rotate(
    integrationId: string,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<RotateWebhookSecretResult>> {
    const endpointResponse = await this.endpoint(integrationId, actor, traceparent);
    const path = `/api/v1/webhook-endpoints/${encodeURIComponent(endpointResponse.body.id)}/actions/rotate-secret` as const;
    return this.engine.post(
      path,
      {},
      callerContext(actor, traceparent, path),
      { idempotencyKey },
    );
  }
}

function callerContext(
  actor: ActorContext,
  traceparent: string | undefined,
  instance: string,
): EngineCallerContext {
  if (!actor.workspace_id) {
    throw new TriggerHttpError(
      403,
      "TRIGGER_WORKSPACE_REQUIRED",
      "Workspace actor context required",
      instance,
    );
  }
  return {
    userId: actor.user_id,
    tenantId: actor.tenant_id,
    workspaceId: actor.workspace_id,
    sessionId: actor.session_id,
    authTime: actor.auth_time ?? Math.floor(Date.now() / 1_000),
    roles: actor.roles,
    permissions: actor.permissions,
    traceparent: parseTraceparent(traceparent, instance) ?? newTraceparent(),
  };
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}
