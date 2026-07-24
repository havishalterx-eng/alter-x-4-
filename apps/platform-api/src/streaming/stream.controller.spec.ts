import { EventEmitter } from "node:events";
import type { ArgumentsHost } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineProblemError } from "../engine";
import { RbacModule } from "../rbac";
import type { ActorContextType } from "../rbac";
import { StreamProblemError } from "./problem";
import { StreamController, writeFrame } from "./stream.controller";
import { StreamExceptionFilter } from "./stream-exception.filter";
import { StreamGateway } from "./stream-gateway";
import type { StreamConnection } from "./types";

const runId = "run_018f47a5-7b2c-7d10-8f11-123456789abc";
const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const traceparent =
  "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
const actor: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  roles: ["viewer"],
  permissions: ["runs:read"],
  session_id: "session-a",
  auth_time: 1_700_000_000,
};

describe("StreamController", () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("opens run and terminal SSE routes with caller context", async () => {
    const connection = connectionStub();
    const gateway = {
      connect: vi.fn().mockResolvedValue(connection.value),
    } as unknown as StreamGateway;
    const controller = new StreamController(gateway);
    const runReply = reply();
    const terminalReply = reply(true);
    const actorWithoutAuthTime = { ...actor };
    delete actorWithoutAuthTime.auth_time;

    await controller.run(
      runId,
      "tab-run",
      undefined,
      traceparent,
      actor,
      request(`/stream/runs/${runId}?tab_id=tab-run`),
      runReply.value,
    );
    await controller.terminal(
      projectId,
      runId,
      "tab-terminal",
      `${runId}:1`,
      undefined,
      actorWithoutAuthTime,
      request(
        `/stream/projects/${projectId}/builds/${runId}/terminal?tab_id=tab-terminal`,
      ),
      terminalReply.value,
    );

    expect(gateway.connect).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tabId: "tab-run",
        target: { kind: "run", runId },
        context: expect.objectContaining({
          tenantId: actor.tenant_id,
          userId: actor.user_id,
          workspaceId: actor.workspace_id,
          sessionId: actor.session_id,
          authTime: actor.auth_time,
          traceparent,
        }),
      }),
    );
    expect(gateway.connect).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        lastEventId: `${runId}:1`,
        target: { kind: "terminal", projectId, runId },
        context: expect.objectContaining({
          traceparent: expect.stringMatching(
            /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
          ),
        }),
      }),
    );
    expect(connection.start).toHaveBeenCalledTimes(2);
    expect(runReply.end).toHaveBeenCalledOnce();
    expect(terminalReply.end).not.toHaveBeenCalled();
  });

  it("rejects validation failures before opening Engine stream", async () => {
    const gateway = {
      connect: vi.fn(),
    } as unknown as StreamGateway;
    const controller = new StreamController(gateway);

    await expect(
      controller.run(
        "bad-run",
        "",
        undefined,
        undefined,
        actor,
        request("/stream/runs/bad-run"),
        reply().value,
      ),
    ).rejects.toMatchObject({
      problem: { status: 400, error_code: "INVALID_STREAM_REQUEST" },
    });
    expect(gateway.connect).not.toHaveBeenCalled();
  });

  it("preserves Engine problem response before SSE headers start", async () => {
    const engineError = new EngineProblemError({
      type: "https://docs.alter.local/problems/RUN_NOT_FOUND",
      title: "Run not found",
      status: 404,
      detail: "Run not found.",
      instance: `/api/v1/runs/${runId}/stream`,
      error_code: "RUN_NOT_FOUND",
      trace_id: "trace",
      request_id: "request",
      retryable: false,
      field_errors: [],
      documentation_key: "RUN_NOT_FOUND",
    });
    const gateway = {
      connect: vi.fn().mockRejectedValue(engineError),
    } as unknown as StreamGateway;
    const output = reply();

    await expect(
      new StreamController(gateway).run(
        runId,
        "tab",
        undefined,
        traceparent,
        actor,
        request(`/stream/runs/${runId}`),
        output.value,
      ),
    ).rejects.toBe(engineError);
    expect(output.hijack).not.toHaveBeenCalled();
  });

  it("denies reconnect without valid actor before Engine subscription", async () => {
    const gateway = {
      connect: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [StreamController],
      providers: [{ provide: StreamGateway, useValue: gateway }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/stream/runs/${runId}?tab_id=reconnect`,
      headers: { traceparent, cookie: "alter_access=invalid" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.json()).toMatchObject({ error_code: "RBAC_ROLE_DENIED" });
    expect(gateway.connect).not.toHaveBeenCalled();
  });

  it("renders stream validation errors as problem+json", () => {
    const output = filterReply();
    const error = new StreamProblemError({
      type: "https://docs.alter.local/problems/INVALID_STREAM_REQUEST",
      title: "Invalid stream request",
      status: 400,
      detail: "Stream request validation failed.",
      instance: "old",
      error_code: "INVALID_STREAM_REQUEST",
      trace_id: "trace",
      request_id: "request",
      retryable: false,
      field_errors: [],
      documentation_key: "INVALID_STREAM_REQUEST",
    });
    new StreamExceptionFilter().catch(error, output.host);
    expect(output.status).toHaveBeenCalledWith(400);
    expect(output.type).toHaveBeenCalledWith("application/problem+json");
    expect(output.send).toHaveBeenCalledWith(
      expect.objectContaining({ instance: "/stream/runs/bad" }),
    );
  });

  it("writes event, comment, and drain-aware SSE frames", async () => {
    const eventReply = reply();
    await writeFrame(eventReply.value, {
      kind: "event",
      event: {
        id: `${runId}:1`,
        type: "run.status",
        data: { status: "running" },
        key: "run.status",
        coalescible: true,
      },
    });
    expect(eventReply.write).toHaveBeenCalledWith(
      `id: ${runId}:1\nevent: run.status\ndata: {"status":"running"}\n\n`,
    );

    const blockedReply = reply(false, false);
    const pending = writeFrame(blockedReply.value, {
      kind: "comment",
      comment: "keepalive",
    });
    blockedReply.raw.emit("drain");
    await pending;
    expect(blockedReply.write).toHaveBeenCalledWith(": keepalive\n\n");
  });
});

function connectionStub() {
  const start = vi.fn();
  const close = vi.fn();
  return {
    start,
    value: {
      closed: Promise.resolve(),
      start,
      close,
      pendingFrames: () => 0,
    } satisfies StreamConnection,
  };
}

function request(url: string): FastifyRequest {
  const raw = new EventEmitter();
  return { url, raw } as unknown as FastifyRequest;
}

function reply(writableEnded = false, writeResult = true) {
  const raw = Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(() => writeResult),
    end: vi.fn(),
    writableEnded,
  });
  const hijack = vi.fn();
  return {
    hijack,
    raw,
    write: raw.write,
    end: raw.end,
    value: { raw, hijack } as unknown as FastifyReply,
  };
}

function filterReply() {
  const response: Record<string, unknown> = {};
  const status = vi.fn(() => response);
  const type = vi.fn(() => response);
  const send = vi.fn(() => response);
  Object.assign(response, { status, type, send });
  return {
    host: {
      switchToHttp: () => ({
        getRequest: () => ({ url: "/stream/runs/bad" }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost,
    status,
    type,
    send,
  };
}
