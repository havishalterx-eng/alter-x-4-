import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EngineClient, type EngineCallerContext, type EngineResponse } from "../engine";
import type { ActorContext } from "../rbac/types";
import { EventHttpError } from "./problem";
import type { EnginePage, EngineResource } from "./types";
import { parseEventId, parseEventListQuery, parseTraceparent, serializeQuery } from "./validation";

@Injectable()
export class EventService {
  constructor(private readonly engine: EngineClient) {}

  list(
    input: unknown,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<EnginePage<EngineResource>>> {
    const instance = "/api/v1/events";
    const query = parseEventListQuery(input, instance);
    return this.engine.get(
      `/api/v1/events${serializeQuery(query)}`,
      callerContext(actor, traceparent, instance),
    );
  }

  get(
    eventId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<EngineResource>> {
    const instance = `/api/v1/events/${eventId}`;
    const id = parseEventId(eventId, instance);
    return this.engine.get(
      `/api/v1/events/${encodeURIComponent(id)}`,
      callerContext(actor, traceparent, instance),
    );
  }
}

function callerContext(
  actor: ActorContext,
  traceparent: string | undefined,
  instance: string,
): EngineCallerContext {
  if (!actor.workspace_id) {
    throw new EventHttpError(403, "EVENT_WORKSPACE_REQUIRED", "Workspace context required", instance);
  }
  return {
    userId: actor.user_id,
    tenantId: actor.tenant_id,
    workspaceId: actor.workspace_id,
    sessionId: actor.session_id,
    authTime: actor.auth_time ?? Math.floor(Date.now() / 1000),
    roles: actor.roles,
    permissions: actor.permissions,
    traceparent: parseTraceparent(traceparent, instance) ?? newTraceparent(),
  };
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}
