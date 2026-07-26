import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
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
import { ProjectHttpError } from "./problem";
import { ProjectExceptionFilter } from "./project-exception.filter";
import { ProjectOperationsService } from "./project-operations.service";
import type {
  ProjectCollection,
  ProjectOpaquePage,
  ProjectOpaqueResource,
} from "./project-operations.types";
import {
  parseProjectActionInput,
  parseProjectPagination,
} from "./project-operations.validation";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;
const privilegedRoles = ["admin", "editor", "operator"] as const;
const writeRoles = ["admin", "editor"] as const;

@Controller("/api/v1")
@UseFilters(ProjectExceptionFilter)
export class ProjectOperationsController {
  constructor(private readonly operations: ProjectOperationsService) {}

  @Get("projects/:projectId/repository")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  async repository(
    @Param("projectId") projectId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaqueResource> {
    const instance = `/api/v1/projects/${projectId}/repository`;
    return project(
      await this.operations.repository(
        projectId,
        requireActor(actor, instance),
        traceparent,
      ),
      reply,
    );
  }

  @Get("projects/:projectId/builds")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  builds(
    @Param("projectId") projectId: string,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaquePage> {
    return this.collection(
      projectId,
      "builds",
      cursor,
      limit,
      actor,
      traceparent,
      reply,
    );
  }

  @Get("projects/:projectId/tests")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  tests(
    @Param("projectId") projectId: string,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaquePage> {
    return this.collection(
      projectId,
      "tests",
      cursor,
      limit,
      actor,
      traceparent,
      reply,
    );
  }

  @Get("projects/:projectId/audit-results")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  auditResults(
    @Param("projectId") projectId: string,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaquePage> {
    return this.collection(
      projectId,
      "audit-results",
      cursor,
      limit,
      actor,
      traceparent,
      reply,
    );
  }

  @Get("projects/:projectId/previews")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  previews(
    @Param("projectId") projectId: string,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaquePage> {
    return this.collection(
      projectId,
      "previews",
      cursor,
      limit,
      actor,
      traceparent,
      reply,
    );
  }

  @Get("projects/:projectId/versions")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  versions(
    @Param("projectId") projectId: string,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaquePage> {
    return this.collection(
      projectId,
      "versions",
      cursor,
      limit,
      actor,
      traceparent,
      reply,
    );
  }

  @Get("projects/:projectId/deployments")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  deployments(
    @Param("projectId") projectId: string,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaquePage> {
    return this.collection(
      projectId,
      "deployments",
      cursor,
      limit,
      actor,
      traceparent,
      reply,
    );
  }

  @Get("deployments/:deploymentId")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("projects:read")
  async deployment(
    @Param("deploymentId") deploymentId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaqueResource> {
    const instance = `/api/v1/deployments/${deploymentId}`;
    return project(
      await this.operations.deployment(
        deploymentId,
        requireActor(actor, instance),
        traceparent,
      ),
      reply,
    );
  }

  @Post("projects/:projectId/actions/deploy")
  @HttpCode(202)
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("projects:deploy")
  @Idempotent()
  async deploy(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaqueResource> {
    const instance = `/api/v1/projects/${projectId}/actions/deploy`;
    return project(
      await this.operations.deploy(
        projectId,
        parseProjectActionInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Post("projects/:projectId/actions/rollback")
  @RequireWorkspaceRole(...privilegedRoles)
  @RequirePermission("projects:deploy")
  @Idempotent()
  async rollback(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaqueResource> {
    const instance = `/api/v1/projects/${projectId}/actions/rollback`;
    return project(
      await this.operations.rollback(
        projectId,
        parseProjectActionInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Post("conversations/:conversationId/actions/handoff")
  @RequireWorkspaceRole(...writeRoles)
  @RequirePermission("projects:write")
  @Idempotent()
  async handoff(
    @Param("conversationId") conversationId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectOpaqueResource> {
    const instance =
      `/api/v1/conversations/${conversationId}/actions/handoff`;
    return project(
      await this.operations.handoff(
        conversationId,
        parseProjectActionInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  private async collection(
    projectId: string,
    collection: ProjectCollection,
    cursor: string | undefined,
    limit: string | undefined,
    actor: ActorContextType | undefined,
    traceparent: string | undefined,
    reply: FastifyReply,
  ): Promise<ProjectOpaquePage> {
    const instance = `/api/v1/projects/${projectId}/${collection}`;
    return project(
      await this.operations.collection(
        projectId,
        collection,
        parseProjectPagination(cursor, limit, instance),
        requireActor(actor, instance),
        traceparent,
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
    throw new ProjectHttpError(
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
