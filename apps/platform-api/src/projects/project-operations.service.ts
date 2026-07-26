import { randomBytes } from "node:crypto";
import type {
  EngineCallerContext,
  EngineClient,
  EngineRequestBody,
  EngineResponse,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import { ProjectHttpError } from "./problem";
import type {
  ProjectActionInput,
  ProjectCollection,
  ProjectOpaquePage,
  ProjectOpaqueResource,
  ProjectPagination,
  SignedReference,
} from "./project-operations.types";
import {
  parseConversationId,
  parseDeploymentId,
} from "./project-operations.validation";
import { parseProjectId, parseTraceparent } from "./validation";

export class ProjectOperationsService {
  constructor(private readonly engine: EngineClient) {}

  repository(
    projectId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<ProjectOpaqueResource>> {
    const instance = `/api/v1/projects/${projectId}/repository`;
    const id = parseProjectId(projectId, instance);
    return this.engine.get(
      `/api/v1/projects/${encodeURIComponent(id)}/repository`,
      callerContext(actor, traceparent, instance),
    );
  }

  collection(
    projectId: string,
    collection: ProjectCollection,
    pagination: ProjectPagination,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<ProjectOpaquePage>> {
    const instance = `/api/v1/projects/${projectId}/${collection}`;
    const id = parseProjectId(projectId, instance);
    return this.engine.get(
      withPagination(
        `/api/v1/projects/${encodeURIComponent(id)}/${collection}`,
        pagination,
      ),
      callerContext(actor, traceparent, instance),
    );
  }

  deployment(
    deploymentId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<ProjectOpaqueResource>> {
    const instance = `/api/v1/deployments/${deploymentId}`;
    const id = parseDeploymentId(deploymentId, instance);
    return this.engine.get(
      `/api/v1/deployments/${encodeURIComponent(id)}`,
      callerContext(actor, traceparent, instance),
    );
  }

  deploy(
    projectId: string,
    input: ProjectActionInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<ProjectOpaqueResource>> {
    return this.projectAction(
      projectId,
      "deploy",
      input,
      actor,
      traceparent,
      idempotencyKey,
    );
  }

  rollback(
    projectId: string,
    input: ProjectActionInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<ProjectOpaqueResource>> {
    return this.projectAction(
      projectId,
      "rollback",
      input,
      actor,
      traceparent,
      idempotencyKey,
    );
  }

  handoff(
    conversationId: string,
    input: ProjectActionInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<SignedReference>> {
    const instance =
      `/api/v1/conversations/${conversationId}/actions/handoff`;
    const id = parseConversationId(conversationId, instance);
    return this.engine.post(
      `/api/v1/conversations/${encodeURIComponent(id)}/actions/handoff`,
      input as EngineRequestBody,
      callerContext(actor, traceparent, instance),
      { idempotencyKey },
    );
  }

  private projectAction(
    projectId: string,
    action: "deploy" | "rollback",
    input: ProjectActionInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<ProjectOpaqueResource>> {
    const instance = `/api/v1/projects/${projectId}/actions/${action}`;
    const id = parseProjectId(projectId, instance);
    return this.engine.post(
      `/api/v1/projects/${encodeURIComponent(id)}/actions/${action}`,
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
    throw new ProjectHttpError(
      403,
      "PROJECT_WORKSPACE_REQUIRED",
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
  pagination: ProjectPagination,
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
