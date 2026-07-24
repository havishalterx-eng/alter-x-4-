import type { ProblemDetails } from "@alterx/contracts";
import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { EngineAuthProvider } from "./auth";
import type { EngineConfig } from "./config";
import { EngineClient } from "./engine-client";
import { EngineExceptionFilter } from "./engine-exception.filter";
import { EngineProblemError } from "./problem";
import type { EngineCallerContext, EnginePath } from "./types";

const config: EngineConfig = {
  baseUrl: "https://engine.test",
  m2mTokenUrl: "https://identity.test/oauth/token",
  m2mAudience: "https://engine.test",
  m2mClientId: "platform-api",
  m2mClientSecretRef: "env:ENGINE_SECRET",
  requestTimeoutMs: 100,
};

const context: EngineCallerContext = {
  userId: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenantId: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspaceId: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  sessionId: "session-1",
  authTime: 1_700_000_000,
  roles: ["owner"],
  permissions: ["workflows:read"],
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
};

const authProvider: EngineAuthProvider = {
  authorize: vi.fn().mockResolvedValue({
    m2mAccessToken: "m2m-token",
    actorToken: "actor-token",
  }),
};

describe("EngineClient", () => {
  it("injects M2M, actor, and trace context into GET requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { id: "workflow-1" }, {
        etag: '"etag-1"',
        request_id: "req-1",
        trace_id: "trc-1",
      }),
    );
    const client = new EngineClient(config, authProvider, fetchImpl, noDelay);

    const response = await client.get<{ id: string }>(
      "/api/v1/workflows/workflow-1",
      context,
    );

    expect(response).toEqual({
      status: 200,
      body: { id: "workflow-1" },
      etag: '"etag-1"',
      requestId: "req-1",
      traceId: "trc-1",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://engine.test/api/v1/workflows/workflow-1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer m2m-token",
          "X-Alter-Actor-Token": "actor-token",
          traceparent: context.traceparent,
        }),
      }),
    );
    expect(authProvider.authorize).toHaveBeenCalledWith(context);
  });

  it("forwards mutation concurrency and idempotency headers", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { id: "workflow-1" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { version: 2 }, { etag: '"new"', location: "/api/v1/runs/1" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new EngineClient(config, authProvider, fetchImpl, noDelay);

    await client.post(
      "/api/v1/workflows",
      { goal: "ship" },
      context,
      { idempotencyKey: "create-1" },
    );
    const patched = await client.patch(
      "/api/v1/workflows/workflow-1",
      { name: "New" },
      context,
      { idempotencyKey: "patch-1", ifMatch: '"old"' },
    );
    const deleted = await client.delete(
      "/api/v1/ads/documents/document-1",
      context,
      { idempotencyKey: "delete-1" },
    );

    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: '{"goal":"ship"}',
        headers: expect.objectContaining({
          "Idempotency-Key": "create-1",
          "content-type": "application/json",
        }),
      }),
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Idempotency-Key": "patch-1",
          "If-Match": '"old"',
        }),
      }),
    );
    expect(patched).toMatchObject({
      etag: '"new"',
      location: "/api/v1/runs/1",
    });
    expect(deleted).toEqual({ status: 204, body: undefined });
  });

  it("passes through valid Engine problem details", async () => {
    const problem = validProblem(409);
    const client = new EngineClient(
      config,
      authProvider,
      vi.fn().mockResolvedValue(problemResponse(problem)),
      noDelay,
    );

    await expect(
      client.post("/api/v1/workflows", {}, context, {
        idempotencyKey: "key",
      }),
    ).rejects.toMatchObject({
      problem,
      status: 409,
    });
  });

  it("sanitizes invalid Engine errors while preserving HTTP status", async () => {
    const client = new EngineClient(
      config,
      authProvider,
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          detail: "SQL failed for tenant secret",
          stack: "internal",
        }),
      ),
      noDelay,
    );

    const error = await client
      .post("/api/v1/workflows", {}, context, { idempotencyKey: "key" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EngineProblemError);
    expect((error as EngineProblemError).problem).toMatchObject({
      status: 503,
      error_code: "UPSTREAM_SERVICE_ERROR",
      detail: "Upstream service request failed.",
    });
    expect(JSON.stringify((error as EngineProblemError).problem)).not.toContain(
      "SQL failed",
    );
  });

  it("retries one GET on retryable response and never retries mutation", async () => {
    const getFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { unavailable: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new EngineClient(config, authProvider, getFetch, noDelay);
    await expect(client.get("/api/v1/system/service-health", context)).resolves.toMatchObject({
      body: { ok: true },
    });
    expect(getFetch).toHaveBeenCalledTimes(2);

    const mutationFetch = vi.fn().mockRejectedValue(new Error("network down"));
    const mutationClient = new EngineClient(
      config,
      authProvider,
      mutationFetch,
      noDelay,
    );
    await expect(
      mutationClient.post("/api/v1/runs", {}, context, {
        idempotencyKey: "run-1",
      }),
    ).rejects.toMatchObject({
      problem: { status: 502, error_code: "UPSTREAM_SERVICE_ERROR" },
    });
    expect(mutationFetch).toHaveBeenCalledOnce();
  });

  it("retries GET network failure once and does not retry client errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new EngineClient(config, authProvider, fetchImpl, noDelay);
    await expect(client.get("/api/v1/workflows", context)).resolves.toMatchObject({
      body: { ok: true },
    });

    const badRequestFetch = vi.fn().mockResolvedValue(problemResponse(validProblem(400)));
    await expect(
      new EngineClient(config, authProvider, badRequestFetch, noDelay).get(
        "/api/v1/workflows",
        context,
      ),
    ).rejects.toMatchObject({ problem: { status: 400 } });
    expect(badRequestFetch).toHaveBeenCalledOnce();
  });

  it("maps aborts to 504 and rejects paths outside Engine v1", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const client = new EngineClient(
      config,
      authProvider,
      vi.fn().mockRejectedValue(abort),
      noDelay,
    );

    await expect(
      client.post("/api/v1/runs", {}, context, { idempotencyKey: "run" }),
    ).rejects.toMatchObject({
      problem: { status: 504, error_code: "UPSTREAM_TIMEOUT" },
    });
    await expect(
      client.get("https://other.test/api/v1/workflows" as EnginePath, context),
    ).rejects.toThrow("Engine path must stay under /api/v1/");
  });

  it("sanitizes auth-provider failure before transport", async () => {
    const fetchImpl = vi.fn();
    const client = new EngineClient(
      config,
      { authorize: vi.fn().mockRejectedValue(new Error("secret unavailable")) },
      fetchImpl,
      noDelay,
    );
    await expect(
      client.get("/api/v1/workflows", context),
    ).rejects.toMatchObject({
      problem: {
        status: 502,
        error_code: "UPSTREAM_SERVICE_ERROR",
        detail: "Upstream service request failed.",
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renders Engine errors as application/problem+json", () => {
    const problem = validProblem(409);
    const reply = filterReply();
    new EngineExceptionFilter().catch(
      new EngineProblemError(problem),
      reply.host,
    );
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.type).toHaveBeenCalledWith("application/problem+json");
    expect(reply.send).toHaveBeenCalledWith(problem);
  });
});

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function validProblem(status: number): ProblemDetails {
  return {
    type: "https://errors.alter.ai/workflow/conflict",
    title: "Workflow conflict",
    status,
    detail: "Workflow state conflict",
    instance: "/api/v1/workflows/workflow-1",
    error_code: "WORKFLOW_CONFLICT",
    trace_id: "trc_018f47a5-7b2c-7d10-8f11-123456789abc",
    request_id: "req_018f47a5-7b2c-7d10-8f11-123456789abd",
    retryable: false,
    field_errors: [],
    documentation_key: "workflow.conflict",
  };
}

function problemResponse(problem: ProblemDetails): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { "content-type": "application/problem+json" },
  });
}

function noDelay(): Promise<void> {
  return Promise.resolve();
}

function filterReply(): {
  host: ArgumentsHost;
  status: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const reply: Record<string, unknown> = {};
  const status = vi.fn(() => reply);
  const type = vi.fn(() => reply);
  const send = vi.fn(() => reply);
  Object.assign(reply, { status, type, send });
  return {
    host: {
      switchToHttp: () => ({ getResponse: () => reply }),
    } as unknown as ArgumentsHost,
    status,
    type,
    send,
  };
}
