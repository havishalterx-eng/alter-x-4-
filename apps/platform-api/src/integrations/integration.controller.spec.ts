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
import {
  RbacModule,
  type ActorContextType,
  type RbacRequest,
} from "../rbac";
import { IntegrationController } from "./integration.controller";
import { IntegrationExceptionFilter } from "./integration-exception.filter";
import { IntegrationModule } from "./integration.module";
import { IntegrationService } from "./integration.service";
import { integrationDeferredCapabilities } from "./types";

const uuid = "018f47a5-7b2c-7d10-8f11-123456789abc";
const integrationId = `int_${uuid}`;
const actor: ActorContextType = {
  user_id: `usr_${uuid}`,
  tenant_id: `ten_${uuid}`,
  workspace_id: `ws_${uuid}`,
  session_id: "session-integration",
  auth_time: 1_700_000_000,
  roles: ["admin"],
  permissions: ["integrations:read", "integrations:write"],
};

describe("Integration catalog routes", () => {
  let app: NestFastifyApplication;
  const engine = new IntegrationEngine();
  const store = new MemoryIdempotencyStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [IntegrationController],
      providers: [
        {
          provide: IntegrationService,
          inject: [EngineClient],
          useFactory: (client: EngineClient) =>
            new IntegrationService(client),
        },
        IntegrationExceptionFilter,
        IdempotencyInterceptor,
        IdempotencyExceptionFilter,
        { provide: EngineClient, useValue: engine },
        { provide: PgIdempotencyStore, useValue: store },
        { provide: APP_FILTER, useClass: EngineExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app
      .getHttpAdapter()
      .getInstance()
      .addHook(
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

  it("relays capability-declared catalog unchanged with pagination", async () => {
    const response = await request({
      method: "GET",
      url: "/api/v1/integrations?cursor=next%2Fpage&limit=25",
      actor,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(engine.catalog);
    expect(engine.get).toHaveBeenCalledWith(
      "/api/v1/integrations?cursor=next%2Fpage&limit=25",
      expect.objectContaining({
        tenantId: actor.tenant_id,
        workspaceId: actor.workspace_id,
        userId: actor.user_id,
        roles: actor.roles,
        permissions: actor.permissions,
      }),
    );
  });

  it("creates integration once and replays stored response", async () => {
    const body = {
      connector: "engine-owned",
      capabilities: ["read", "write"],
      opaque_settings: { whitespace: " preserve\n" },
    };
    const options = {
      method: "POST",
      url: "/api/v1/integrations",
      body,
      actor,
      headers: { "idempotency-key": "create-integration" },
    };
    const first = await request(options);
    const replay = await request(options);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual(engine.created);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(engine.created);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(engine.post).toHaveBeenCalledTimes(1);
    expect(engine.post).toHaveBeenCalledWith(
      "/api/v1/integrations",
      body,
      expect.any(Object),
      { idempotencyKey: "create-integration" },
    );
  });

  it("relays one-shot connection test and idempotently replays", async () => {
    const body = { probe: { engine_extension: true } };
    const options = {
      method: "POST",
      url: `/api/v1/integrations/${integrationId}/actions/test`,
      body,
      actor,
      headers: { "idempotency-key": "test-integration" },
    };
    const first = await request(options);
    const replay = await request(options);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual(engine.testResult);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(engine.post).toHaveBeenCalledTimes(1);
    expect(engine.post).toHaveBeenCalledWith(
      `/api/v1/integrations/${integrationId}/actions/test`,
      body,
      expect.any(Object),
      { idempotencyKey: "test-integration" },
    );
  });

  it.each([
    ["GET", "/api/v1/integrations", undefined],
    ["POST", "/api/v1/integrations", {}],
    [
      "POST",
      `/api/v1/integrations/${integrationId}/actions/test`,
      {},
    ],
  ])("scope-gates %s %s before Engine", async (method, url, body) => {
    const response = await request({
      method,
      url,
      body,
      actor: { ...actor, permissions: [] },
      headers:
        method === "POST" ? { "idempotency-key": "denied" } : undefined,
    });
    expectProblem(response, 403, "RBAC_PERMISSION_DENIED");
    expect(engine.get).not.toHaveBeenCalled();
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("requires privileged role for create and connection test", async () => {
    for (const url of [
      "/api/v1/integrations",
      `/api/v1/integrations/${integrationId}/actions/test`,
    ]) {
      const response = await request({
        method: "POST",
        url,
        body: {},
        actor: { ...actor, roles: ["viewer"] },
        headers: { "idempotency-key": `viewer-${url}` },
      });
      expectProblem(response, 403, "RBAC_ROLE_DENIED");
    }
    expect(engine.post).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/api/v1/integrations?limit=0", undefined],
    ["GET", "/api/v1/integrations?limit=201", undefined],
    ["GET", "/api/v1/integrations?cursor=", undefined],
    ["POST", "/api/v1/integrations", []],
    ["POST", "/api/v1/integrations/bad/actions/test", {}],
    [
      "POST",
      `/api/v1/integrations/${integrationId}/actions/test`,
      [],
    ],
  ])("returns problem+json validation for %s %s", async (method, url, body) => {
    const response = await request({
      method,
      url,
      body,
      actor,
      headers:
        method === "POST"
          ? { "idempotency-key": `invalid-${url}` }
          : undefined,
    });
    expectProblem(response, 400, "INTEGRATION_VALIDATION_FAILED");
  });

  it.each([
    ["GET", "/api/v1/integrations", undefined, "/api/v1/integrations"],
    ["POST", "/api/v1/integrations", {}, "/api/v1/integrations"],
    [
      "POST",
      `/api/v1/integrations/${integrationId}/actions/test`,
      {},
      `/api/v1/integrations/${integrationId}/actions/test`,
    ],
  ])(
    "passes Engine problem through for %s %s",
    async (method, url, body, enginePath) => {
      engine.failNext(method, enginePath);
      const response = await request({
        method,
        url,
        body,
        actor,
        headers:
          method === "POST"
            ? { "idempotency-key": `failure-${url}` }
            : undefined,
      });
      expectProblem(response, 503, "ENGINE_INTEGRATION_UNAVAILABLE");
    },
  );

  it("requires Idempotency-Key on create and test", async () => {
    for (const url of [
      "/api/v1/integrations",
      `/api/v1/integrations/${integrationId}/actions/test`,
    ]) {
      const response = await request({
        method: "POST",
        url,
        body: {},
        actor,
      });
      expectProblem(response, 400, "IDEMPOTENCY_KEY_REQUIRED");
    }
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("flags deferred capabilities and leaves fake routes absent", async () => {
    expect(integrationDeferredCapabilities).toEqual([
      expect.objectContaining({
        capability: "oauth_flows",
        status: "NOT_MET",
      }),
      expect.objectContaining({
        capability: "connection_health_monitoring",
        status: "NOT_MET",
      }),
      expect.objectContaining({
        capability: "scope_display_revocation",
        status: "NOT_MET",
      }),
      expect.objectContaining({
        capability: "per_workspace_binding",
        status: "NOT_MET",
      }),
    ]);

    for (const [method, url] of [
      ["GET", "/api/v1/integrations/oauth/authorize"],
      ["GET", "/api/v1/integrations/oauth/callback"],
      ["POST", `/api/v1/integrations/${integrationId}/actions/connect`],
      ["GET", `/api/v1/integrations/${integrationId}/health`],
      ["GET", `/api/v1/integrations/${integrationId}/scopes`],
      ["POST", `/api/v1/integrations/${integrationId}/actions/revoke`],
      ["GET", `/api/v1/integrations/${integrationId}/workspace-binding`],
    ] as const) {
      expect((await request({ method, url, body: {}, actor })).statusCode).toBe(
        404,
      );
    }
  });

  it("default-denies absent actor and workspace context", async () => {
    const noActor = await request({
      method: "GET",
      url: "/api/v1/integrations",
    });
    expectProblem(noActor, 403, "RBAC_ROLE_DENIED");

    const controller = new IntegrationController({
      catalog: vi.fn(),
    } as unknown as IntegrationService);
    await expect(
      controller.catalog(
        undefined,
        undefined,
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toMatchObject({
      status: 401,
      response: { error_code: "AUTHENTICATION_REQUIRED" },
    });

    const { workspace_id: _workspaceId, ...withoutWorkspace } = actor;
    void _workspaceId;
    const noWorkspace = await request({
      method: "GET",
      url: "/api/v1/integrations",
      actor: withoutWorkspace,
    });
    expectProblem(noWorkspace, 403, "INTEGRATION_WORKSPACE_REQUIRED");
  });

  it("validates trace context and wires production module", async () => {
    const invalid = await request({
      method: "GET",
      url: "/api/v1/integrations",
      actor,
      headers: { traceparent: "invalid" },
    });
    expectProblem(invalid, 400, "INTEGRATION_VALIDATION_FAILED");

    const validTrace =
      "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
    const valid = await request({
      method: "GET",
      url: "/api/v1/integrations",
      actor,
      headers: { traceparent: validTrace },
    });
    expect(valid.statusCode).toBe(200);
    expect(engine.get).toHaveBeenLastCalledWith(
      "/api/v1/integrations",
      expect.objectContaining({ traceparent: validTrace }),
    );
    expect(IntegrationModule).toBeDefined();
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

class IntegrationEngine {
  readonly catalog = {
    data: [
      {
        connector: "engine-owned",
        capabilities: ["opaque", { nested: true }],
        untouched: null,
      },
    ],
    page: { next_cursor: "engine-next", has_more: true },
  };
  readonly created = {
    id: integrationId,
    engine_owned: { status: "created", nested: ["opaque"] },
  };
  readonly testResult = {
    id: integrationId,
    engine_owned: { probe: "complete", healthy: true },
  };
  readonly get = vi.fn(this.getResponse.bind(this));
  readonly post = vi.fn(this.postResponse.bind(this));
  private failure: { method: string; path: string } | undefined;

  reset(): void {
    this.get.mockClear();
    this.post.mockClear();
    this.failure = undefined;
  }

  failNext(method: string, path: string): void {
    this.failure = { method, path };
  }

  private async getResponse(
    path: EnginePath,
    context: EngineCallerContext,
  ): Promise<EngineResponse<unknown>> {
    void context;
    this.throwIfFailed("GET", path);
    return { status: 200, body: this.catalog };
  }

  private async postResponse(
    path: EnginePath,
    body: EngineRequestBody,
    context: EngineCallerContext,
    options: { idempotencyKey: string },
  ): Promise<EngineResponse<unknown>> {
    void body;
    void context;
    void options;
    this.throwIfFailed("POST", path);
    return path.endsWith("/actions/test")
      ? { status: 200, body: this.testResult }
      : { status: 201, body: this.created };
  }

  private throwIfFailed(method: string, path: string): void {
    if (this.failure?.method !== method || this.failure.path !== path) return;
    this.failure = undefined;
    throw new EngineProblemError({
      type: "https://errors.alter.ai/engine-integration-unavailable",
      title: "ENGINE_INTEGRATION_UNAVAILABLE",
      status: 503,
      detail: "Engine integration unavailable",
      instance: path,
      error_code: "ENGINE_INTEGRATION_UNAVAILABLE",
      trace_id: "trc_engine",
      request_id: "req_engine",
      retryable: true,
      field_errors: [],
      documentation_key: "engine.integration.unavailable",
    });
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
    const mapKey = `${input.tenantId}:${input.key}`;
    const stored = this.responses.get(mapKey);
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
    const result = await operation();
    this.responses.set(mapKey, { ...result, fingerprint: input.fingerprint });
    return { ...result, replayed: false };
  }
}

function expectProblem(
  response: TestResponse,
  status: number,
  code: string,
): void {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain(
    "application/problem+json",
  );
  expect(response.json()).toMatchObject({ status, error_code: code });
}

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
