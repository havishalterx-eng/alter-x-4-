import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ActorContext, RequirePermission, RequireWorkspaceRole } from "../rbac";
import type { ActorContextType } from "../rbac";
import { StreamProblemError, streamProblem } from "./problem";
import { StreamGateway } from "./stream-gateway";
import type {
  StreamConnection,
  StreamFrame,
  StreamTarget,
} from "./types";

const workspaceStreamRoles = [
  "admin",
  "editor",
  "operator",
  "approver",
  "viewer",
] as const;
const runIdPattern =
  /^run_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const projectIdPattern =
  /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tabIdPattern = /^[a-zA-Z0-9._:-]{1,128}$/;
const traceparentPattern =
  /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

@Controller("stream")
export class StreamController {
  constructor(private readonly gateway: StreamGateway) {}

  @RequireWorkspaceRole(...workspaceStreamRoles)
  @RequirePermission("runs:read")
  @Get("runs/:runId")
  run(
    @Param("runId") runId: string,
    @Query("tab_id") tabId: string | undefined,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @ActorContext() actor: ActorContextType,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.open(
      { kind: "run", runId },
      tabId,
      lastEventId,
      traceparent,
      actor,
      request,
      reply,
    );
  }

  @RequireWorkspaceRole(...workspaceStreamRoles)
  @RequirePermission("runs:read")
  @Get("projects/:projectId/builds/:runId/terminal")
  terminal(
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Query("tab_id") tabId: string | undefined,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @ActorContext() actor: ActorContextType,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.open(
      { kind: "terminal", projectId, runId },
      tabId,
      lastEventId,
      traceparent,
      actor,
      request,
      reply,
    );
  }

  private async open(
    target: StreamTarget,
    tabId: string | undefined,
    lastEventId: string | undefined,
    traceparent: string | undefined,
    actor: ActorContextType,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    validateRequest(target, tabId, lastEventId, traceparent, request.url);
    const connection = await this.gateway.connect({
      tabId: tabId!,
      ...(lastEventId ? { lastEventId } : {}),
      target,
      context: {
        userId: actor.user_id,
        tenantId: actor.tenant_id,
        workspaceId: actor.workspace_id!,
        sessionId: actor.session_id,
        authTime: actor.auth_time ?? Math.floor(Date.now() / 1000),
        roles: actor.roles,
        permissions: actor.permissions,
        traceparent: traceparent ?? newTraceparent(),
      },
      sink: (frame) => writeFrame(reply, frame),
    });

    startSse(reply);
    connection.start();
    closeWithRequest(request, connection);
    await connection.closed;
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  }
}

function validateRequest(
  target: StreamTarget,
  tabId: string | undefined,
  lastEventId: string | undefined,
  traceparent: string | undefined,
  instance: string,
): void {
  const validTarget =
    runIdPattern.test(target.runId) &&
    (target.kind === "run" || projectIdPattern.test(target.projectId));
  if (
    !validTarget ||
    !tabId ||
    !tabIdPattern.test(tabId) ||
    (traceparent !== undefined && !traceparentPattern.test(traceparent)) ||
    (lastEventId?.length ?? 0) > 256 ||
    (lastEventId !== undefined &&
      !new RegExp(`^${target.runId}:(0|[1-9]\\d*)$`, "i").test(lastEventId))
  ) {
    throw new StreamProblemError(
      streamProblem(400, "INVALID_STREAM_REQUEST", instance),
    );
  }
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}

function startSse(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  reply.raw.flushHeaders();
}

export async function writeFrame(
  reply: FastifyReply,
  frame: StreamFrame,
): Promise<void> {
  const payload =
    frame.kind === "comment"
      ? `: ${frame.comment}\n\n`
      : `id: ${frame.event.id}\nevent: ${frame.event.type}\ndata: ${JSON.stringify(frame.event.data)}\n\n`;
  if (!reply.raw.write(payload)) {
    await once(reply.raw, "drain");
  }
}

function closeWithRequest(
  request: FastifyRequest,
  connection: StreamConnection,
): void {
  request.raw.once("close", () => connection.close());
}
