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
import {
  RbacModule,
  type ActorContextType,
  type RbacRequest,
} from "../rbac";
import { ProjectExceptionFilter } from "./project-exception.filter";
import { ProjectOperationsController } from "./project-operations.controller";
import { ProjectOperationsService } from "./project-operations.service";

const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const deploymentId = "dep_018f47a5-7b2c-7d10-8f11-123456789abc";
const conversationId = "cnv_018f47a5-7b2c-7d10-8f11-123456789abc";
const tenantId = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const workspaceId = "ws_018f47a5-7b2c-7d10-8f11-123456789abc";
const opaqueHandoffResource = {
  engine_owned: {
    nested: ["opaque", 7, true],
    whitespace: " preserved\n",
  },
  untouched: null,
} as const;

const reader: ActorContextType = actor("viewer", ["projects:read"]);
const deployer: ActorContextType = actor("operator", ["projects:deploy"]);
const writer: ActorContextType = actor("editor", ["projects:write"]);

describe("ProjectOperationsController routes", () => {
  let app: NestFastifyApplication;
  const engine = new OperationsEngine();
  const store = new MemoryIdempotencyStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [ProjectOperationsController],
      providers: [
        {
          provide: ProjectOperationsService,
          inject: [EngineClient],
          useFactory: (client: EngineClient) =>
            new ProjectOperationsService(client),
        },
        ProjectExceptionFilter,
        IdempotencyInterceptor,
        IdempotencyExceptionFilter,
        { provide: EngineClient, useValue: engine },
        { provide: PgIdempotencyStore, useValue: store },
        {
          provide: APP_FILTER,
          useClass: EngineExceptionFilter,
        },
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

  afterAll(async () => {
    await app.close();
  });

  it.each(routeCases())(
    "serves contract-backed route %s %s",
    async ({ method, path, actor: routeActor, body, status }) => {
      const response = await request(method, path, {
        actor: routeActor,
        body,
        ...(method === "POST"
          ? { headers: { "idempotency-key": `happy-${path}` } }
          : {}),
      });
      expect(response.statusCode).toBe(status);
    },
  );

  it("passes repository tree, content, and diff through unchanged", async () => {
    const response = await request(
      "GET",
      `/api/v1/projects/${projectId}/repository`,
      { actor: reader },
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers.request_id).toBe("req_engine");
    expect(response.headers.trace_id).toBe("trc_engine");
    expect(response.json()).toEqual({
      project_id: projectId,
      file_tree: [{ path: "src/index.ts", type: "file" }],
      file: { path: "src/index.ts", content: "export const ready = true;\n" },
      diff: { base: "main", patch: "@@ -0,0 +1 @@" },
    });
  });

  it("relays pagination for every project read view", async () => {
    for (const collection of collections) {
      const response = await request(
        "GET",
        `/api/v1/projects/${projectId}/${collection}?cursor=next%20page&limit=25`,
        { actor: reader },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: [{ collection }],
        page: { next_cursor: null, has_more: false },
      });
      expect(engine.get).toHaveBeenCalledWith(
        `/api/v1/projects/${projectId}/${collection}?cursor=next+page&limit=25`,
        expect.any(Object),
      );
    }
  });

  it("replays deploy without double execution and preserves routing recommendation", async () => {
    const path = `/api/v1/projects/${projectId}/actions/deploy`;
    const options = {
      actor: deployer,
      headers: { "idempotency-key": "deploy-key" },
      body: {
        environment_id: "env_018f47a5-7b2c-7d10-8f11-123456789abc",
      },
    };
    const first = await request("POST", path, options);
    const replay = await request("POST", path, options);

    expect(first.statusCode).toBe(202);
    expect(first.headers.location).toBe(
      `/api/v1/deployments/${deploymentId}`,
    );
    expect(first.json()).toEqual({
      deployment_id: deploymentId,
      status: "deploying",
      routing_recommendation: {
        target: "edge-eu",
        reason: "Closest verified healthy region",
        confidence: 0.94,
      },
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(engine.post).toHaveBeenCalledOnce();
  });

  it.each([
    [
      `/api/v1/projects/${projectId}/actions/rollback`,
      deployer,
      { deployment_id: deploymentId },
    ],
    [
      `/api/v1/conversations/${conversationId}/actions/handoff`,
      writer,
      { format: "zip", include_history: true },
    ],
  ] as const)("replays mutation %s without double execution", async (
    path,
    routeActor,
    body,
  ) => {
    const options = {
      actor: routeActor,
      headers: { "idempotency-key": `replay-${path}` },
      body,
    };
    const first = await request("POST", path, options);
    const replay = await request("POST", path, options);
    expect(first.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(engine.post).toHaveBeenCalledOnce();
  });

  it("relays opaque Engine handoff response without BFF mutation", async () => {
    const response = await request(
      "POST",
      `/api/v1/conversations/${conversationId}/actions/handoff`,
      {
        actor: writer,
        headers: { "idempotency-key": "opaque-handoff-key" },
        body: { format: "engine-owned" },
      },
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(opaqueHandoffResource);
  });

  it.each(routeCases())(
    "denies missing permission for %s %s",
    async ({ method, path, actor: routeActor, body }) => {
      const deniedActor = { ...routeActor, permissions: [] };
      const response = await request(method, path, {
        actor: deniedActor,
        body,
        headers: { "idempotency-key": `denied-${path}` },
      });
      expectProblem(response, 403, "RBAC_PERMISSION_DENIED");
      expect(engine.get).not.toHaveBeenCalled();
      expect(engine.post).not.toHaveBeenCalled();
    },
  );

  it.each(invalidCases())(
    "rejects invalid request %s %s",
    async ({ method, path, actor: routeActor, body }) => {
      const response = await request(method, path, {
        actor: routeActor,
        body,
        headers: { "idempotency-key": `invalid-${path}` },
      });
      expectProblem(response, 400, "PROJECT_VALIDATION_FAILED");
    },
  );

  it.each(routeCases())(
    "passes through Engine problem for %s %s",
    async ({
      method,
      path,
      enginePath,
      actor: routeActor,
      body,
    }) => {
      engine.failNext(method, enginePath);
      const response = await request(method, path, {
        actor: routeActor,
        body,
        headers: { "idempotency-key": `engine-${path}` },
      });
      expectProblem(response, 409, "ENGINE_PROJECT_CONFLICT");
      expect(response.json()).toMatchObject({
        detail: "Engine project state conflict",
        retryable: false,
      });
    },
  );

  it.each(routeCases().filter((route) => route.method === "POST"))(
    "requires Idempotency-Key for %s %s",
    async ({ method, path, actor: routeActor, body }) => {
      const response = await request(method, path, {
        actor: routeActor,
        body,
      });
      expectProblem(response, 400, "IDEMPOTENCY_KEY_REQUIRED");
      expect(engine.post).not.toHaveBeenCalled();
    },
  );

  it("keeps env-var masking and maintenance absent when contracts are missing", async () => {
    const paths = [
      `/api/v1/projects/${projectId}/environment-variables`,
      `/api/v1/projects/${projectId}/maintenance`,
      "/api/v1/environments",
    ];
    for (const path of paths) {
      const response = await request("GET", path, { actor: reader });
      expect(response.statusCode).toBe(404);
    }
    expect(engine.get).not.toHaveBeenCalled();
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("keeps direct controller calls default-deny without actor", async () => {
    const controller = new ProjectOperationsController({
      repository: vi.fn(),
    } as unknown as ProjectOperationsService);
    await expect(
      controller.repository(
        projectId,
        undefined,
        undefined,
        {} as import("fastify").FastifyReply,
      ),
    ).rejects.toMatchObject({
      status: 401,
      response: { error_code: "AUTHENTICATION_REQUIRED" },
    });
  });

  function request(
    method: "GET" | "POST",
    url: string,
    options: {
      actor?: ActorContextType;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ): Promise<TestResponse> {
    const injectOptions: {
      method: "GET" | "POST";
      url: string;
      headers: Record<string, string>;
      payload?: object;
    } = {
      method,
      url,
      headers: {
        ...(options.actor
          ? { "x-test-actor": JSON.stringify(options.actor) }
          : {}),
        ...options.headers,
      },
    };
    if (options.body !== undefined) {
      injectOptions.payload = options.body as object;
    }
    return app
      .getHttpAdapter()
      .getInstance()
      .inject(injectOptions) as Promise<TestResponse>;
  }
});

interface TestResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  json(): unknown;
}

class OperationsEngine {
  readonly get = vi.fn(this.getResponse.bind(this));
  readonly post = vi.fn(this.postResponse.bind(this));
  private failure: { method: string; path: string } | undefined;

  reset(): void {
    this.failure = undefined;
    this.get.mockClear();
    this.post.mockClear();
  }

  failNext(method: string, path: string): void {
    this.failure = { method, path };
  }

  private async getResponse(
    path: EnginePath,
    _context: EngineCallerContext,
  ): Promise<EngineResponse<Readonly<Record<string, JsonValue>>>> {
    void _context;
    this.throwIfFailed("GET", path);
    if (path.endsWith("/repository")) {
      return {
        status: 200,
        body: {
          project_id: projectId,
          file_tree: [{ path: "src/index.ts", type: "file" }],
          file: {
            path: "src/index.ts",
            content: "export const ready = true;\n",
          },
          diff: { base: "main", patch: "@@ -0,0 +1 @@" },
        },
        requestId: "req_engine",
        traceId: "trc_engine",
      };
    }
    if (path === `/api/v1/deployments/${deploymentId}`) {
      return {
        status: 200,
        body: {
          deployment_id: deploymentId,
          project_id: projectId,
          status: "ready",
        },
      };
    }
    const collection = path.split("?")[0]?.split("/").at(-1) ?? "unknown";
    return {
      status: 200,
      body: {
        data: [{ collection }],
        page: { next_cursor: null, has_more: false },
      },
    };
  }

  private async postResponse(
    path: EnginePath,
    body: EngineRequestBody,
    _context: EngineCallerContext,
    _options: { idempotencyKey: string },
  ): Promise<EngineResponse<Readonly<Record<string, JsonValue>>>> {
    void body;
    void _context;
    void _options;
    this.throwIfFailed("POST", path);
    if (path.endsWith("/actions/deploy")) {
      return {
        status: 202,
        body: {
          deployment_id: deploymentId,
          status: "deploying",
          routing_recommendation: {
            target: "edge-eu",
            reason: "Closest verified healthy region",
            confidence: 0.94,
          },
        },
        location: `/api/v1/deployments/${deploymentId}`,
      };
    }
    if (path.endsWith("/actions/rollback")) {
      return {
        status: 200,
        body: {
          deployment_id: deploymentId,
          action: "rollback",
          status: "accepted",
        },
      };
    }
    return {
      status: 200,
      body: opaqueHandoffResource,
    };
  }

  private throwIfFailed(method: string, path: string): void {
    if (this.failure?.method !== method || this.failure.path !== path) {
      return;
    }
    this.failure = undefined;
    throw new EngineProblemError({
      type: "https://errors.alter.ai/engine-project-conflict",
      title: "ENGINE_PROJECT_CONFLICT",
      status: 409,
      detail: "Engine project state conflict",
      instance: path,
      error_code: "ENGINE_PROJECT_CONFLICT",
      trace_id: "trc_engine",
      request_id: "req_engine",
      retryable: false,
      field_errors: [],
      documentation_key: "engine.project.conflict",
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

const collections = [
  "builds",
  "tests",
  "audit-results",
  "previews",
  "versions",
  "deployments",
] as const;

interface OperationRouteCase {
  method: "GET" | "POST";
  path: string;
  enginePath: string;
  actor: ActorContextType;
  body?: unknown;
  status: number;
}

interface InvalidRouteCase {
  method: "GET" | "POST";
  path: string;
  actor: ActorContextType;
  body?: unknown;
}

function routeCases(): OperationRouteCase[] {
  return [
    {
      method: "GET",
      path: `/api/v1/projects/${projectId}/repository`,
      enginePath: `/api/v1/projects/${projectId}/repository`,
      actor: reader,
      status: 200,
    },
    ...collections.map((collection) => ({
      method: "GET" as const,
      path: `/api/v1/projects/${projectId}/${collection}`,
      enginePath: `/api/v1/projects/${projectId}/${collection}`,
      actor: reader,
      status: 200,
    })),
    {
      method: "GET",
      path: `/api/v1/deployments/${deploymentId}`,
      enginePath: `/api/v1/deployments/${deploymentId}`,
      actor: reader,
      status: 200,
    },
    {
      method: "POST",
      path: `/api/v1/projects/${projectId}/actions/deploy`,
      enginePath: `/api/v1/projects/${projectId}/actions/deploy`,
      actor: deployer,
      body: { environment_id: "env_018f47a5" },
      status: 202,
    },
    {
      method: "POST",
      path: `/api/v1/projects/${projectId}/actions/rollback`,
      enginePath: `/api/v1/projects/${projectId}/actions/rollback`,
      actor: deployer,
      body: { deployment_id: deploymentId },
      status: 200,
    },
    {
      method: "POST",
      path: `/api/v1/conversations/${conversationId}/actions/handoff`,
      enginePath:
        `/api/v1/conversations/${conversationId}/actions/handoff`,
      actor: writer,
      body: { format: "zip" },
      status: 200,
    },
  ];
}

function invalidCases(): InvalidRouteCase[] {
  return [
    {
      method: "GET",
      path: "/api/v1/projects/bad/repository",
      actor: reader,
    },
    ...collections.map((collection) => ({
      method: "GET" as const,
      path: `/api/v1/projects/bad/${collection}`,
      actor: reader,
    })),
    {
      method: "GET",
      path: "/api/v1/deployments/bad",
      actor: reader,
    },
    {
      method: "POST",
      path: "/api/v1/projects/bad/actions/deploy",
      actor: deployer,
      body: {},
    },
    {
      method: "POST",
      path: "/api/v1/projects/bad/actions/rollback",
      actor: deployer,
      body: {},
    },
    {
      method: "POST",
      path: "/api/v1/conversations/bad/actions/handoff",
      actor: writer,
      body: {},
    },
    {
      method: "GET",
      path: `/api/v1/projects/${projectId}/builds?limit=201`,
      actor: reader,
    },
    {
      method: "POST",
      path: `/api/v1/projects/${projectId}/actions/deploy`,
      actor: deployer,
      body: [],
    },
  ];
}

function actor(
  role: "editor" | "operator" | "viewer",
  permissions: string[],
): ActorContextType {
  return {
    user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
    tenant_id: tenantId,
    workspace_id: workspaceId,
    session_id: `session-${role}`,
    auth_time: 1_700_000_000,
    roles: [role],
    permissions,
  };
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
