import { randomBytes } from "node:crypto";
import type {
  EngineCallerContext,
  EngineClient,
  EngineRequestBody,
  EngineResponse,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import { IntegrationHttpError } from "./problem";
import type {
  IntegrationInput,
  IntegrationPage,
  IntegrationPagination,
  IntegrationResource,
} from "./types";
import {
  parseIntegrationId,
  parseTraceparent,
} from "./validation";

export class IntegrationService {
  constructor(private readonly engine: EngineClient) {}

  catalog(
    pagination: IntegrationPagination,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<IntegrationPage>> {
    const instance = "/api/v1/integrations";
    return this.engine.get(
      withPagination(instance, pagination),
      callerContext(actor, traceparent, instance),
    );
  }

  create(
    input: IntegrationInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<IntegrationResource>> {
    const instance = "/api/v1/integrations";
    return this.engine.post(
      instance,
      input as EngineRequestBody,
      callerContext(actor, traceparent, instance),
      { idempotencyKey },
    );
  }

  test(
    integrationId: string,
    input: IntegrationInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<IntegrationResource>> {
    const instance =
      `/api/v1/integrations/${integrationId}/actions/test`;
    const id = parseIntegrationId(integrationId, instance);
    return this.engine.post(
      `/api/v1/integrations/${encodeURIComponent(id)}/actions/test`,
      input as EngineRequestBody,
      callerContext(actor, traceparent, instance),
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
    throw new IntegrationHttpError(
      403,
      "INTEGRATION_WORKSPACE_REQUIRED",
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

function withPagination(
  path: `/api/v1/${string}`,
  pagination: IntegrationPagination,
): `/api/v1/${string}` {
  const query = new URLSearchParams();
  if (pagination.cursor) query.set("cursor", pagination.cursor);
  if (pagination.limit !== undefined) {
    query.set("limit", pagination.limit.toString());
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}
