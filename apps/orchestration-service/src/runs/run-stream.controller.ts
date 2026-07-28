import { randomUUID } from "node:crypto";
import { Controller, Get, Headers, HttpException, Param, Req, Res } from "@nestjs/common";
import type { SessionGatewayRequest } from "@alterx/auth";
import type { ProblemDetails } from "@alterx/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RunStreamEventService } from "./run-stream-event.service";

const HEARTBEAT_MS = 15_000;

@Controller("api/v1/runs")
export class RunStreamController {
  constructor(private readonly events: RunStreamEventService) {}

  @Get(":id/stream")
  async stream(
    @Req() request: FastifyRequest & SessionGatewayRequest,
    @Res() reply: FastifyReply,
    @Param("id") runId: string,
    @Headers("last-event-id") lastEventId: string | undefined,
  ): Promise<void> {
    const tenantId = request.actorContext?.tenant_id;
    if (!tenantId) {
      throw problem(reply, 401, "AUTH_CONTEXT_REQUIRED", "Authenticated tenant context is required.");
    }
    if (
      lastEventId !== undefined &&
      !/^(0|[1-9]\d*)$/.test(lastEventId)
    ) {
      throw problem(reply, 400, "INVALID_LAST_EVENT_ID", "Last-Event-ID must be a non-negative integer.");
    }
    let cursor = lastEventId === undefined ? 0 : Number(lastEventId);
    if (!Number.isSafeInteger(cursor)) {
      throw problem(reply, 400, "INVALID_LAST_EVENT_ID", "Last-Event-ID is outside the supported range.");
    }
    if (!(await this.events.runIsVisible(tenantId, runId))) {
      throw problem(reply, 404, "RUN_NOT_FOUND", "The requested run was not found.");
    }
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    reply.raw.flushHeaders();
    const deadline = request.actorTokenExpiresAtMs ?? Date.now() + 300_000;
    let heartbeatAt = Date.now() + HEARTBEAT_MS;
    while (!reply.raw.writableEnded && !reply.raw.destroyed && Date.now() < deadline) {
      const events = await this.events.listAfter(tenantId, runId, cursor);
      for (const event of events) {
        await write(reply, `id: ${event.seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`);
        cursor = event.seq;
      }
      if (Date.now() >= heartbeatAt) {
        await write(reply, ": keepalive\n\n");
        heartbeatAt = Date.now() + HEARTBEAT_MS;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    reply.raw.end();
  }
}

async function write(reply: FastifyReply, frame: string): Promise<void> {
  if (reply.raw.write(frame)) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      reply.raw.off("drain", done);
      reply.raw.off("close", done);
      resolve();
    };
    reply.raw.once("drain", done);
    reply.raw.once("close", done);
  });
}

function problem(
  reply: FastifyReply,
  status: number,
  errorCode: string,
  detail: string,
): HttpException {
  reply.header("content-type", "application/problem+json");
  const body: ProblemDetails = {
    type: `https://alter.dev/problems/${errorCode.toLowerCase().replaceAll("_", "-")}`,
    title: status === 404 ? "Not Found" : status === 401 ? "Unauthorized" : "Bad Request",
    status,
    detail,
    instance: "/runs/{id}/stream",
    error_code: errorCode,
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: `runs.stream.${errorCode.toLowerCase().replaceAll("_", "-")}`,
  };
  return new HttpException(body, status);
}

function prefixedUuidV7(prefix: "trc" | "req"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}
