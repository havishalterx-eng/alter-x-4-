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
  type ActorContextType,
} from "../rbac";
import { ActionCentreExceptionFilter } from "./action-centre-exception.filter";
import { ActionCentreService } from "./action-centre.service";
import { ActionCentreHttpError } from "./problem";
import type {
  ActionQueuePage,
  EngineResource,
} from "./types";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;
const decisionRoles = ["admin", "operator", "approver"] as const;

@Controller("/api/v1/action-centre")
@UseFilters(ActionCentreExceptionFilter)
export class ActionQueueController {
  constructor(private readonly actionCentre: ActionCentreService) {}

  @Get()
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("human-actions:read")
  queue(
    @Query() query: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ): Promise<ActionQueuePage> {
    return this.actionCentre.queue(
      query,
      requireActor(actor, "/api/v1/action-centre"),
      traceparent,
    );
  }
}
@Controller("/api/v1/approvals")
@UseFilters(ActionCentreExceptionFilter)
export class ApprovalActionController {
  constructor(private readonly actionCentre: ActionCentreService) {}

  @Post(":approvalId/actions/approve")
  @RequireWorkspaceRole(...decisionRoles)
  @RequirePermission("approvals:decide")
  @Idempotent()
  approve(
    @Param("approvalId") approvalId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EngineResource> {
    return this.decision(
      approvalId,
      "approve",
      body,
      actor,
      traceparent,
      idempotencyKey,
      reply,
    );
  }

  @Post(":approvalId/actions/reject")
  @RequireWorkspaceRole(...decisionRoles)
  @RequirePermission("approvals:decide")
  @Idempotent()
  reject(
    @Param("approvalId") approvalId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EngineResource> {
    return this.decision(
      approvalId,
      "reject",
      body,
      actor,
      traceparent,
      idempotencyKey,
      reply,
    );
  }

  private async decision(
    approvalId: string,
    action: "approve" | "reject",
    body: unknown,
    actor: ActorContextType | undefined,
    traceparent: string | undefined,
    idempotencyKey: string | undefined,
    reply: FastifyReply,
  ): Promise<EngineResource> {
    const instance = `/api/v1/approvals/${approvalId}/actions/${action}`;
    return project(
      await this.actionCentre.decideApproval(
        approvalId,
        action,
        body,
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }
}

@Controller("/api/v1/escalations")
@UseFilters(ActionCentreExceptionFilter)
export class EscalationActionController {
  constructor(private readonly actionCentre: ActionCentreService) {}

  @Post(":escalationId/actions/claim")
  @RequireWorkspaceRole(...decisionRoles)
  @RequirePermission("escalations:claim")
  @Idempotent()
  claim(
    @Param("escalationId") escalationId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EngineResource> {
    return this.action(
      escalationId,
      "claim",
      body,
      actor,
      traceparent,
      idempotencyKey,
      reply,
    );
  }

  @Post(":escalationId/actions/resolve")
  @RequireWorkspaceRole(...decisionRoles)
  @RequirePermission("escalations:resolve")
  @Idempotent()
  resolve(
    @Param("escalationId") escalationId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EngineResource> {
    return this.action(
      escalationId,
      "resolve",
      body,
      actor,
      traceparent,
      idempotencyKey,
      reply,
    );
  }

  private async action(
    escalationId: string,
    action: "claim" | "resolve",
    body: unknown,
    actor: ActorContextType | undefined,
    traceparent: string | undefined,
    idempotencyKey: string | undefined,
    reply: FastifyReply,
  ): Promise<EngineResource> {
    const instance = `/api/v1/escalations/${escalationId}/actions/${action}`;
    return project(
      await this.actionCentre.actOnEscalation(
        escalationId,
        action,
        body,
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }
}

@Controller("/api/v1/runs")
@UseFilters(ActionCentreExceptionFilter)
export class RunClarificationActionController {
  constructor(private readonly actionCentre: ActionCentreService) {}

  @Post(":runId/clarifications/:clarificationId/answer")
  @RequireWorkspaceRole(...decisionRoles)
  @RequirePermission("runs:clarifications:answer")
  @Idempotent()
  async answer(
    @Param("runId") runId: string,
    @Param("clarificationId") clarificationId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EngineResource> {
    const instance =
      `/api/v1/runs/${runId}/clarifications/${clarificationId}/answer`;
    return project(
      await this.actionCentre.answerClarification(
        runId,
        clarificationId,
        body,
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
    throw new ActionCentreHttpError(
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
