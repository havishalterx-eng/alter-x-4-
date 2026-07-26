import type { JsonValue } from "@alterx/shared-clients";
import { APP_FILTER } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  EngineClient,
  EngineExceptionFilter,
  EngineProblemError,
  type EngineCallerContext,
  type EnginePath,
  type EngineRequestBody,
  type EngineResponse,
} from "../engine";
import {
  IdempotencyExceptionFilter,
  IdempotencyHttpError,
  IdempotencyInterceptor,
  PgIdempotencyStore,
  type IdempotencyExecution,
  type StoredHttpResponse,
} from "../idempotency";
import { ETAG_RESOURCE_RESOLVER } from "../concurrency";
import {
  RbacModule,
  type ActorContextType,
  type RbacRequest,
} from "../rbac";
import { WorkflowController } from "../workflows/workflow.controller";
import { WorkflowExceptionFilter } from "../workflows/workflow-exception.filter";
import { WorkflowService } from "../workflows/workflow.service";
import {
  ActionQueueController,
  ApprovalActionController,
  EscalationActionController,
  RunClarificationActionController,
} from "./action-centre.controller";
import { ActionCentreExceptionFilter } from "./action-centre-exception.filter";
import { ActionCentreModule } from "./action-centre.module";
import { ActionCentreService } from "./action-centre.service";
import type { EnginePage, EngineResource } from "./types";

const uuid = "018f47a5-7b2c-7d10-8f11-123456789abc";
const approvalId = `apr_${uuid}`;
const escalationId = `esc_${uuid}`;
const runId = `run_${uuid}`;
const clarificationId = `clr_${uuid}`;
const workflowId = `wf_${uuid}`;
const actor: ActorContextType = {
  user_id: `usr_${uuid}`,
  tenant_id: `ten_${uuid}`,
  workspace_id: `ws_${uuid}`,
  session_id: "session-action-centre",
  auth_time: 1_700_000_000,
  roles: ["approver"],
  permissions: [
    "human-actions:read",
    "approvals:decide",
    "escalations:claim",
    "escalations:resolve",
    "runs:clarifications:answer",
  ],
};
const noPermissions: ActorContextType = { ...actor, permissions: [] };

describe("Human Action Centre routes", () => {
  let app: NestFastifyApplication;
  const engine = new StatefulActionEngine();
  const store = new MemoryIdempotencyStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [
        ActionQueueController,
        ApprovalActionController,
        EscalationActionController,
        RunClarificationActionController,
        WorkflowController,
      ],
      providers: [
        ActionCentreService,
        WorkflowService,
        ActionCentreExceptionFilter,
        WorkflowExceptionFilter,
        IdempotencyInterceptor,
        IdempotencyExceptionFilter,
        { provide: EngineClient, useValue: engine },
        { provide: PgIdempotencyStore, useValue: store },
        {
          provide: ETAG_RESOURCE_RESOLVER,
          useValue: { resolve: vi.fn() },
        },
        { provide: APP_FILTER, useClass: EngineExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.getHttpAdapter().getInstance().addHook(
      "preHandler",
      (request: FastifyRequest, _reply: unknown, done: () => void) => {
        const value = request.headers["x-test-actor"];
        if (typeof value === "string") {
          (request as RbacRequest).actorContext = JSON.parse(
            value,
          ) as ActorContextType;
        }
        done();
      },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    engine.reset();
    store.clear();
  });

  afterAll(async () => app.close());

  it("merges both queues with tagged, lossless BFF pagination", async () => {
    const first = await request({
      method: "GET",
      url: "/api/v1/action-centre?limit=2",
      actor,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      data: [
        { source_type: "approval", item: engine.approvals[0] },
        { source_type: "escalation", item: engine.escalations[0] },
      ],
      page: { has_more: true, limit: 2 },
    });

    const firstBody = first.json() as QueueResponse;
    const second = await request({
      method: "GET",
      url: `/api/v1/action-centre?limit=2&cursor=${encodeURIComponent(firstBody.page.next_cursor!)}`,
      actor,
    });
    expect((second.json() as QueueResponse).data).toEqual([
      { source_type: "approval", item: engine.approvals[1] },
      { source_type: "escalation", item: engine.escalations[1] },
    ]);

    const secondBody = second.json() as QueueResponse;
    const third = await request({
      method: "GET",
      url: `/api/v1/action-centre?limit=2&cursor=${encodeURIComponent(secondBody.page.next_cursor!)}`,
      actor,
    });
    expect((third.json() as QueueResponse).data).toEqual([
      { source_type: "approval", item: engine.approvals[2] },
    ]);
    expect((third.json() as QueueResponse).page.has_more).toBe(false);
  });

  it("uses only contract-backed source and status filters", async () => {
    const approval = await request({
      method: "GET",
      url: "/api/v1/action-centre?type=approval&status=pending&limit=5",
      actor,
    });
    expect((approval.json() as QueueResponse).data.every(
      (item) => item.source_type === "approval",
    )).toBe(true);
    expect(engine.get).toHaveBeenCalledWith(
      "/api/v1/approvals?limit=5&status=pending",
      expect.objectContaining({
        tenantId: actor.tenant_id,
        permissions: actor.permissions,
      }),
    );
    expect(
      engine.get.mock.calls.some(([path]) =>
        String(path).startsWith("/api/v1/escalations"),
      ),
    ).toBe(false);

    engine.get.mockClear();
    const escalation = await request({
      method: "GET",
      url: "/api/v1/action-centre?type=escalation&limit=5",
      actor,
    });
    expect((escalation.json() as QueueResponse).data.every(
      (item) => item.source_type === "escalation",
    )).toBe(true);
    expect(engine.get).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid Engine page instead of looping its cursor", async () => {
    engine.invalidPage = true;
    const response = await request({
      method: "GET",
      url: "/api/v1/action-centre?type=approval",
      actor,
    });
    expectProblem(response, 502, "INVALID_ENGINE_ACTION_QUEUE_RESPONSE");
  });

  it.each(actionCases())(
    "relays and idempotently replays %s %s",
    async (method, url, body, permission) => {
      const scoped = { ...actor, permissions: [permission] };
      const options = {
        method,
        url,
        body,
        actor: scoped,
        headers: { "idempotency-key": `key-${permission}` },
      } as const;
      const first = await request(options);
      const second = await request(options);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.headers["idempotency-replayed"]).toBe("true");
      expect(engine.post).toHaveBeenCalledTimes(1);
      expect(first.json()).toMatchObject({ opaque_engine_field: true });
    },
  );

  it("passes opaque clarification answer to Engine unchanged", async () => {
    const body = { answer: " Use PostgreSQL\n", nested: { extension: 1 } };
    const response = await request({
      method: "POST",
      url: `/api/v1/runs/${runId}/clarifications/${clarificationId}/answer`,
      body,
      actor: { ...actor, permissions: ["runs:clarifications:answer"] },
      headers: { "idempotency-key": "clarification-opaque" },
    });
    expect(response.statusCode).toBe(200);
    expect(engine.post).toHaveBeenCalledWith(
      `/api/v1/runs/${runId}/clarifications/${clarificationId}/answer`,
      body,
      expect.any(Object),
      { idempotencyKey: "clarification-opaque" },
    );
  });

  it("approval decision resumes a run paused through T10a", async () => {
    const operator = {
      ...actor,
      roles: ["operator"] as ActorContextType["roles"],
      permissions: ["approvals:decide"],
    };
    const paused = await request({
      method: "POST",
      url: `/api/v1/workflows/${workflowId}/actions/pause`,
      body: {},
      actor: operator,
      headers: { "idempotency-key": "pause-workflow" },
    });
    expect(paused.statusCode).toBe(200);
    expect(engine.runStatus).toBe("paused");

    const approved = await request({
      method: "POST",
      url: `/api/v1/approvals/${approvalId}/actions/approve`,
      body: { note: "Resume" },
      actor: operator,
      headers: { "idempotency-key": "resume-by-approval" },
    });
    expect(approved.statusCode).toBe(200);
    expect(engine.runStatus).toBe("running");
  });

  it("passes Engine 409 through on a competing escalation claim", async () => {
    const scoped = { ...actor, permissions: ["escalations:claim"] };
    const url = `/api/v1/escalations/${escalationId}/actions/claim`;
    expect(
      (
        await request({
          method: "POST",
          url,
          body: {},
          actor: scoped,
          headers: { "idempotency-key": "claim-one" },
        })
      ).statusCode,
    ).toBe(200);
    const conflict = await request({
      method: "POST",
      url,
      body: {},
      actor: scoped,
      headers: { "idempotency-key": "claim-two" },
    });
    expectProblem(conflict, 409, "ESCALATION_ALREADY_CLAIMED");
  });

  it.each(scopeCases())("scope-gates %s %s", async (method, url, body) => {
    const response = await request({
      method,
      url,
      body,
      actor: noPermissions,
      headers: method === "POST" ? { "idempotency-key": "denied" } : undefined,
    });
    expectProblem(response, 403, "RBAC_PERMISSION_DENIED");
    expect(engine.get).not.toHaveBeenCalled();
    expect(engine.post).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/api/v1/action-centre?type=escalation&status=pending", undefined],
    [
      "POST",
      "/api/v1/approvals/bad/actions/approve",
      {},
    ],
    [
      "POST",
      `/api/v1/escalations/${escalationId}/actions/resolve`,
      [],
    ],
    [
      "POST",
      `/api/v1/runs/${runId}/clarifications/bad/answer`,
      {},
    ],
  ])("returns problem+json validation for %s %s", async (method, url, body) => {
    const response = await request({
      method,
      url,
      body,
      actor,
      headers: method === "POST" ? { "idempotency-key": "invalid" } : undefined,
    });
    expectProblem(response, 400, "INVALID_ACTION_CENTRE_REQUEST");
  });

  it.each(engineErrorCases())("passes Engine problem through for %s %s", async (method, url, body, failurePath) => {
    engine.failNext(failurePath);
    const response = await request({
      method,
      url,
      body,
      actor,
      headers: method === "POST" ? { "idempotency-key": `fail-${url}` } : undefined,
    });
    expectProblem(response, 503, "ENGINE_ACTION_UNAVAILABLE");
  });

  it("requires Idempotency-Key on every mutation", async () => {
    for (const [method, url, body] of actionCases()) {
      const response = await request({ method, url, body, actor });
      expectProblem(response, 400, "IDEMPOTENCY_KEY_REQUIRED");
    }
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("marks all deferred capabilities and leaves fake routes absent", async () => {
    const queue = await request({
      method: "GET",
      url: "/api/v1/action-centre",
      actor,
    });
    expect((queue.json() as QueueResponse).deferred).toEqual([
      expect.objectContaining({ capability: "clarifications_in_queue", status: "NOT_MET" }),
      expect.objectContaining({ capability: "universal_claim", status: "NOT_MET" }),
      expect.objectContaining({ capability: "annotate", status: "NOT_MET" }),
      expect.objectContaining({ capability: "assign_reassign", status: "NOT_MET" }),
      expect.objectContaining({ capability: "expiry", status: "NOT_MET" }),
    ]);
    for (const url of [
      "/api/v1/action-centre/clarifications",
      `/api/v1/approvals/${approvalId}/actions/claim`,
      `/api/v1/approvals/${approvalId}/actions/annotate`,
      `/api/v1/approvals/${approvalId}/actions/assign`,
      `/api/v1/approvals/${approvalId}/actions/expire`,
    ]) {
      expect(
        (await request({ method: "POST", url, body: {}, actor })).statusCode,
      ).toBe(404);
    }
  });

  it("keeps direct queue calls default-deny without actor context", async () => {
    const controller = new ActionQueueController(
      { queue: vi.fn() } as unknown as ActionCentreService,
    );
    try {
      controller.queue({}, undefined, undefined);
      expect.fail("Expected default-deny");
    } catch (error) {
      expect(error).toMatchObject({
        status: 401,
        response: { error_code: "AUTHENTICATION_REQUIRED" },
      });
    }
  });

  it("rejects action access without workspace context", async () => {
    const { workspace_id: _workspaceId, ...actorWithoutWorkspace } = actor;
    void _workspaceId;
    const response = await request({
      method: "GET",
      url: "/api/v1/action-centre",
      actor: actorWithoutWorkspace,
    });
    expectProblem(response, 403, "ACTION_CENTRE_WORKSPACE_REQUIRED");
  });

  it("wires the production module", () => {
    expect(ActionCentreModule).toBeDefined();
  });

  function request(options: RequestOptions): Promise<TestResponse> {
    return app.getHttpAdapter().getInstance().inject({
      method: options.method,
      url: options.url,
      payload: options.body as never,
      headers: {
        ...(options.actor
          ? { "x-test-actor": JSON.stringify(options.actor) }
          : {}),
        ...options.headers,
      },
    } as never) as Promise<TestResponse>;
  }
});

type QueueResponse = {
  data: Array<{ source_type: "approval" | "escalation"; item: EngineResource }>;
  page: { next_cursor: string | null; has_more: boolean; limit: number };
  deferred: Array<{ capability: string; status: string; reason: string }>;
};

interface RequestOptions {
  method: string;
  url: string;
  body?: unknown;
  actor?: ActorContextType;
  headers?: Record<string, string> | undefined;
}

interface TestResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  json(): unknown;
}

class StatefulActionEngine {
  readonly approvals: EngineResource[] = [
    { approval_id: approvalId, status: "pending", mode: "workflow" },
    { approval_id: `${approvalId}-2`, status: "pending", mode: "project" },
    { approval_id: `${approvalId}-3`, status: "pending", mode: "workflow" },
  ];
  readonly escalations: EngineResource[] = [
    { escalation_id: escalationId, severity: "high" },
    { escalation_id: `${escalationId}-2`, engine_extension: true },
  ];
  readonly get = vi.fn(this.getResponse.bind(this));
  readonly post = vi.fn(this.postResponse.bind(this));
  runStatus: "running" | "paused" = "running";
  private failurePath: string | undefined;
  private claimed = false;
  invalidPage = false;

  reset(): void {
    this.get.mockClear();
    this.post.mockClear();
    this.failurePath = undefined;
    this.claimed = false;
    this.invalidPage = false;
    this.runStatus = "running";
  }

  failNext(path: string): void {
    this.failurePath = path;
  }

  private async getResponse(
    path: EnginePath,
    _context: EngineCallerContext,
  ): Promise<EngineResponse<EnginePage<EngineResource>>> {
    void _context;
    this.throwIfFailed(path);
    const url = new URL(path, "https://engine.internal");
    const limit = Number(url.searchParams.get("limit"));
    if (url.pathname === "/api/v1/approvals") {
      const next = url.searchParams.get("cursor");
      const data = next === "approval-next"
        ? this.approvals.slice(2)
        : this.approvals.slice(0, 2);
      return {
        status: 200,
        body: page(
          data.slice(0, limit),
          next || this.invalidPage ? null : "approval-next",
          this.invalidPage ? true : undefined,
        ),
      };
    }
    if (url.pathname === "/api/v1/escalations") {
      return {
        status: 200,
        body: page(this.escalations.slice(0, limit), null),
      };
    }
    throw new Error(`Unexpected GET ${path}`);
  }

  private async postResponse(
    path: EnginePath,
    body: EngineRequestBody,
    _context: EngineCallerContext,
    _options: { idempotencyKey: string },
  ): Promise<EngineResponse<EngineResource>> {
    void body;
    void _context;
    void _options;
    this.throwIfFailed(path);
    if (path === `/api/v1/workflows/${workflowId}/actions/pause`) {
      this.runStatus = "paused";
      return { status: 200, body: { status: "paused" } };
    }
    if (path === `/api/v1/approvals/${approvalId}/actions/approve`) {
      this.runStatus = "running";
    }
    if (path === `/api/v1/approvals/${approvalId}/actions/reject`) {
      return {
        status: 200,
        body: { opaque_engine_field: true, received: body as JsonValue },
        location: `/api/v1/approvals/${approvalId}`,
      };
    }
    if (path === `/api/v1/escalations/${escalationId}/actions/claim`) {
      if (this.claimed) {
        throw problem(409, "ESCALATION_ALREADY_CLAIMED");
      }
      this.claimed = true;
    }
    return {
      status: 200,
      body: { opaque_engine_field: true, received: body as JsonValue },
      requestId: "req_engine",
      traceId: "trc_engine",
    };
  }

  private throwIfFailed(path: string): void {
    const bare = path.split("?")[0]!;
    if (this.failurePath === bare) {
      this.failurePath = undefined;
      throw problem(503, "ENGINE_ACTION_UNAVAILABLE");
    }
  }
}

class MemoryIdempotencyStore {
  private readonly responses = new Map<
    string,
    StoredHttpResponse & { fingerprint: string }
  >();

  clear(): void {
    this.responses.clear();
  }

  async execute(
    input: IdempotencyExecution,
    operation: () => Promise<StoredHttpResponse>,
  ) {
    if (!input.key) {
      throw new IdempotencyHttpError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key header required",
        input.instance,
      );
    }
    const key = `${input.tenantId}:${input.key}`;
    const stored = this.responses.get(key);
    if (stored) {
      if (stored.fingerprint !== input.fingerprint) {
        throw new IdempotencyHttpError(
          422,
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key reused with different request",
          input.instance,
        );
      }
      return { status: stored.status, body: stored.body, replayed: true };
    }
    const response = await operation();
    this.responses.set(key, { ...response, fingerprint: input.fingerprint });
    return { ...response, replayed: false };
  }
}

function actionCases() {
  return [
    [
      "POST",
      `/api/v1/approvals/${approvalId}/actions/approve`,
      { note: "Approved" },
      "approvals:decide",
    ],
    [
      "POST",
      `/api/v1/approvals/${approvalId}/actions/reject`,
      { note: "Rejected" },
      "approvals:decide",
    ],
    [
      "POST",
      `/api/v1/escalations/${escalationId}/actions/resolve`,
      { resolution: "Resolved" },
      "escalations:resolve",
    ],
    [
      "POST",
      `/api/v1/escalations/${escalationId}/actions/claim`,
      {},
      "escalations:claim",
    ],
    [
      "POST",
      `/api/v1/runs/${runId}/clarifications/${clarificationId}/answer`,
      { answer: "Answer" },
      "runs:clarifications:answer",
    ],
  ] as const;
}

function scopeCases(): ReadonlyArray<
  readonly [string, string, unknown]
> {
  return [
    ["GET", "/api/v1/action-centre", undefined],
    ...actionCases().map(
      ([method, url, body]) => [method, url, body] as const,
    ),
  ];
}

function engineErrorCases(): ReadonlyArray<
  readonly [string, string, unknown, string]
> {
  return [
    ["GET", "/api/v1/action-centre", undefined, "/api/v1/approvals"],
    ...actionCases().map(
      ([method, url, body]) => [method, url, body, url] as const,
    ),
  ];
}

function page(
  data: readonly EngineResource[],
  nextCursor: string | null,
  hasMore = nextCursor !== null,
): EnginePage<EngineResource> {
  return {
    data,
    page: {
      next_cursor: nextCursor,
      has_more: hasMore,
      limit: 2,
    },
  };
}

function problem(status: number, errorCode: string): EngineProblemError {
  return new EngineProblemError({
    type: `https://errors.alter.ai/${errorCode.toLowerCase()}`,
    title: errorCode,
    status,
    detail: "Engine action failed",
    instance: "/api/v1/action",
    error_code: errorCode,
    trace_id: "trc_engine",
    request_id: "req_engine",
    retryable: status >= 500,
    field_errors: [],
    documentation_key: errorCode.toLowerCase(),
  });
}

function expectProblem(
  response: TestResponse,
  status: number,
  errorCode: string,
): void {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain(
    "application/problem+json",
  );
  expect(response.json()).toMatchObject({
    status,
    error_code: errorCode,
    field_errors: expect.any(Array),
  });
}
