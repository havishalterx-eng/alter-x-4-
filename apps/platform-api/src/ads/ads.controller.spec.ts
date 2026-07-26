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
import { AdsController } from "./ads.controller";
import { AdsExceptionFilter } from "./ads-exception.filter";
import { AdsModule } from "./ads.module";
import { AdsService } from "./ads.service";
import { adsDeferredCapabilities } from "./types";

const uuid = "018f47a5-7b2c-7d10-8f11-123456789abc";
const sourceId = `src_${uuid}`;
const jobId = `job_${uuid}`;
const documentId = `doc_${uuid}`;
const actor: ActorContextType = {
  user_id: `usr_${uuid}`,
  tenant_id: `ten_${uuid}`,
  workspace_id: `ws_${uuid}`,
  session_id: "session-ads",
  auth_time: 1_700_000_000,
  roles: ["admin"],
  permissions: ["knowledge:read", "knowledge:admin", "knowledge:delete"],
};

describe("ADS administration routes", () => {
  let app: NestFastifyApplication;
  const engine = new AdsEngine();
  const store = new MemoryIdempotencyStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [AdsController],
      providers: [
        {
          provide: AdsService,
          inject: [EngineClient],
          useFactory: (client: EngineClient) => new AdsService(client),
        },
        AdsExceptionFilter,
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

  it.each(mutationCases())(
    "relays and idempotently replays %s %s",
    async (method, url, body, status) => {
      const options = {
        method,
        url,
        body,
        actor,
        headers: { "idempotency-key": `key-${url}` },
      };
      const first = await request(options);
      const second = await request(options);
      expect(first.statusCode).toBe(status);
      expect(second.statusCode).toBe(status);
      expect(second.headers["idempotency-replayed"]).toBe("true");
      expect(engine.mutationCount()).toBe(1);
    },
  );

  it("relays opaque upload response and declared ingestion-job Location unchanged", async () => {
    const input = {
      filename: "handbook.pdf",
      content_type: "application/pdf",
      opaque_extension: { checksum: "abc" },
    };
    const upload = await request({
      method: "POST",
      url: "/api/v1/ads/ingestion/uploads",
      body: input,
      actor,
      headers: { "idempotency-key": "upload-flow" },
    });
    expect(upload.statusCode).toBe(202);
    expect(upload.json()).toEqual(engine.uploadResource);
    expect(upload.headers.location).toBe(
      `/api/v1/ads/ingestion/jobs/${jobId}`,
    );
    expect(engine.post).toHaveBeenCalledWith(
      "/api/v1/ads/ingestion/uploads",
      input,
      expect.objectContaining({
        tenantId: actor.tenant_id,
        workspaceId: actor.workspace_id,
        permissions: actor.permissions,
      }),
      { idempotencyKey: "upload-flow" },
    );

    const job = await request({
      method: "GET",
      url: `/api/v1/ads/ingestion/jobs/${jobId}`,
      actor,
    });
    expect(job.statusCode).toBe(200);
    expect(job.json()).toEqual(engine.jobResource);
  });

  it("relays document pagination, detail, and opaque deletion response", async () => {
    const list = await request({
      method: "GET",
      url: "/api/v1/ads/documents?cursor=next%2Fpage&limit=25",
      actor,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual(engine.documentPage);
    expect(engine.get).toHaveBeenCalledWith(
      "/api/v1/ads/documents?cursor=next%2Fpage&limit=25",
      expect.any(Object),
    );

    const detail = await request({
      method: "GET",
      url: `/api/v1/ads/documents/${documentId}`,
      actor,
    });
    expect(detail.json()).toEqual(engine.documentResource);

    const removed = await request({
      method: "DELETE",
      url: `/api/v1/ads/documents/${documentId}`,
      actor,
      headers: { "idempotency-key": "delete-document" },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual(engine.deletedResource);
    expect(removed.json()).not.toHaveProperty("deletion_certificate");
  });

  it("passes source, sync, and knowledge bodies to Engine unchanged", async () => {
    const createBody = { connector: "drive", settings: { folder: " a/b\n" } };
    const source = await request({
      method: "POST",
      url: "/api/v1/ads/sources",
      body: createBody,
      actor,
      headers: { "idempotency-key": "source-create" },
    });
    expect(source.statusCode).toBe(201);
    expect(engine.post).toHaveBeenCalledWith(
      "/api/v1/ads/sources",
      createBody,
      expect.any(Object),
      { idempotencyKey: "source-create" },
    );

    const syncBody = { full: true, engine_extension: ["opaque"] };
    const sync = await request({
      method: "POST",
      url: `/api/v1/ads/sources/${sourceId}/actions/sync`,
      body: syncBody,
      actor,
      headers: { "idempotency-key": "source-sync" },
    });
    expect(sync.statusCode).toBe(202);
    expect(engine.post).toHaveBeenCalledWith(
      `/api/v1/ads/sources/${sourceId}/actions/sync`,
      syncBody,
      expect.any(Object),
      { idempotencyKey: "source-sync" },
    );

    const knowledgeBody = { title: "Policy", content: " preserve me\n" };
    await request({
      method: "POST",
      url: "/api/v1/ads/knowledge",
      body: knowledgeBody,
      actor,
      headers: { "idempotency-key": "knowledge-create" },
    });
    expect(engine.post).toHaveBeenCalledWith(
      "/api/v1/ads/knowledge",
      knowledgeBody,
      expect.any(Object),
      { idempotencyKey: "knowledge-create" },
    );
  });

  it.each(routeCases())(
    "scope-gates %s %s before Engine",
    async (method, url, body) => {
      const response = await request({
        method,
        url,
        body,
        actor: { ...actor, permissions: [] },
        headers: isMutation(method)
          ? { "idempotency-key": "denied" }
          : undefined,
      });
      expectProblem(response, 403, "RBAC_PERMISSION_DENIED");
      expect(engine.get).not.toHaveBeenCalled();
      expect(engine.post).not.toHaveBeenCalled();
      expect(engine.delete).not.toHaveBeenCalled();
    },
  );

  it("requires admin role for writes and privileged admin role for deletion", async () => {
    const editorDelete = await request({
      method: "DELETE",
      url: `/api/v1/ads/documents/${documentId}`,
      actor: { ...actor, roles: ["editor"] },
      headers: { "idempotency-key": "editor-delete" },
    });
    expectProblem(editorDelete, 403, "RBAC_ROLE_DENIED");

    const viewerCreate = await request({
      method: "POST",
      url: "/api/v1/ads/sources",
      body: {},
      actor: { ...actor, roles: ["viewer"] },
      headers: { "idempotency-key": "viewer-create" },
    });
    expectProblem(viewerCreate, 403, "RBAC_ROLE_DENIED");
  });

  it.each([
    ["GET", "/api/v1/ads/documents?limit=201", undefined],
    ["GET", "/api/v1/ads/documents?cursor=", undefined],
    ["GET", "/api/v1/ads/documents/bad", undefined],
    ["GET", "/api/v1/ads/ingestion/jobs/bad", undefined],
    ["POST", `/api/v1/ads/sources/${sourceId}/actions/sync`, []],
    ["POST", "/api/v1/ads/knowledge", []],
  ])("returns problem+json validation for %s %s", async (method, url, body) => {
    const response = await request({
      method,
      url,
      body,
      actor,
      headers: isMutation(method)
        ? { "idempotency-key": `invalid-${url}` }
        : undefined,
    });
    expectProblem(response, 400, "ADS_VALIDATION_FAILED");
  });

  it.each(engineErrorCases())(
    "passes Engine problem through for %s %s",
    async (method, url, body, enginePath) => {
      engine.failNext(method, enginePath);
      const response = await request({
        method,
        url,
        body,
        actor,
        headers: isMutation(method)
          ? { "idempotency-key": `failure-${url}` }
          : undefined,
      });
      expectProblem(response, 503, "ENGINE_ADS_UNAVAILABLE");
    },
  );

  it("requires Idempotency-Key for every mutation", async () => {
    for (const [method, url, body] of mutationCases()) {
      const response = await request({ method, url, body, actor });
      expectProblem(response, 400, "IDEMPOTENCY_KEY_REQUIRED");
    }
    expect(engine.mutationCount()).toBe(0);
  });

  it("flags every deferred surface and leaves fabricated routes absent", async () => {
    expect(adsDeferredCapabilities).toEqual([
      expect.objectContaining({
        capability: "upload_signed_url_job_shape",
        status: "NOT_MET",
      }),
      expect.objectContaining({
        capability: "retrieval_testing",
        status: "NOT_MET",
      }),
      expect.objectContaining({
        capability: "retrieval_provenance_confidence",
        status: "NOT_MET",
      }),
      expect.objectContaining({ capability: "reindex", status: "NOT_MET" }),
      expect.objectContaining({
        capability: "retention_config",
        status: "NOT_MET",
      }),
      expect.objectContaining({
        capability: "source_permissions",
        status: "NOT_MET",
      }),
      expect.objectContaining({
        capability: "deletion_certificate",
        status: "NOT_MET",
      }),
    ]);

    for (const [method, url] of [
      ["POST", "/api/v1/ads/retrieval"],
      ["POST", `/api/v1/ads/sources/${sourceId}/actions/reindex`],
      ["GET", "/api/v1/ads/retention"],
      ["GET", `/api/v1/ads/sources/${sourceId}/permissions`],
      ["GET", `/api/v1/ads/documents/${documentId}/deletion-certificate`],
    ] as const) {
      expect((await request({ method, url, body: {}, actor })).statusCode).toBe(
        404,
      );
    }
  });

  it("default-denies missing actor and workspace context", async () => {
    const unauthenticated = await request({
      method: "GET",
      url: "/api/v1/ads/documents",
    });
    expectProblem(unauthenticated, 403, "RBAC_ROLE_DENIED");

    const controller = new AdsController({
      documents: vi.fn(),
    } as unknown as AdsService);
    await expect(
      controller.documents(
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
      url: "/api/v1/ads/documents",
      actor: withoutWorkspace,
    });
    expectProblem(noWorkspace, 403, "ADS_WORKSPACE_REQUIRED");
  });

  it("rejects malformed trace context and wires the production module", async () => {
    const response = await request({
      method: "GET",
      url: "/api/v1/ads/documents",
      actor,
      headers: { traceparent: "bad-trace" },
    });
    expectProblem(response, 400, "ADS_VALIDATION_FAILED");
    expect(AdsModule).toBeDefined();
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

class AdsEngine {
  readonly uploadResource = {
    engine_owned: {
      nested: ["opaque", 7, true],
      whitespace: " preserved\n",
    },
    untouched: null,
  };
  readonly jobResource = {
    id: jobId,
    state: "queued",
    opaque_engine_extension: ["untouched"],
  };
  readonly documentResource = {
    id: documentId,
    title: "Policy",
    opaque_metadata: { nested: true },
  };
  readonly documentPage = {
    data: [this.documentResource],
    page: { next_cursor: "next-engine", has_more: true },
  };
  readonly deletedResource = {
    id: documentId,
    deleted: true,
    engine_receipt: { opaque: "value" },
  };
  readonly get = vi.fn(this.getResponse.bind(this));
  readonly post = vi.fn(this.postResponse.bind(this));
  readonly delete = vi.fn(this.deleteResponse.bind(this));
  private failure: { method: string; path: string } | undefined;

  reset(): void {
    this.get.mockClear();
    this.post.mockClear();
    this.delete.mockClear();
    this.failure = undefined;
  }

  mutationCount(): number {
    return this.post.mock.calls.length + this.delete.mock.calls.length;
  }

  failNext(method: string, path: string): void {
    this.failure = { method, path };
  }

  private async getResponse(
    path: EnginePath,
    _context: EngineCallerContext,
  ): Promise<EngineResponse<unknown>> {
    void _context;
    this.throwIfFailed("GET", path);
    const pathname = new URL(path, "https://engine.internal").pathname;
    if (pathname === `/api/v1/ads/ingestion/jobs/${jobId}`) {
      return response(this.jobResource);
    }
    if (pathname === "/api/v1/ads/documents") {
      return response(this.documentPage);
    }
    return response(this.documentResource);
  }

  private async postResponse(
    path: EnginePath,
    body: EngineRequestBody,
    _context: EngineCallerContext,
    _options: { idempotencyKey: string },
  ): Promise<EngineResponse<unknown>> {
    void body;
    void _context;
    void _options;
    this.throwIfFailed("POST", path);
    if (path === "/api/v1/ads/ingestion/uploads") {
      return {
        status: 202,
        body: this.uploadResource,
        location: `/api/v1/ads/ingestion/jobs/${jobId}`,
      };
    }
    if (path.endsWith("/actions/sync")) {
      return { status: 202, body: { id: sourceId, state: "syncing" } };
    }
    return {
      status: 201,
      body: path.endsWith("/sources")
        ? { id: sourceId, created: true }
        : { id: `knw_${uuid}`, created: true },
    };
  }

  private async deleteResponse(
    path: EnginePath,
    _context: EngineCallerContext,
    _options: { idempotencyKey: string },
  ): Promise<EngineResponse<unknown>> {
    void _context;
    void _options;
    this.throwIfFailed("DELETE", path);
    return response(this.deletedResource);
  }

  private throwIfFailed(method: string, path: string): void {
    if (this.failure?.method !== method || this.failure.path !== path) return;
    this.failure = undefined;
    throw new EngineProblemError({
      type: "https://errors.alter.ai/engine-ads-unavailable",
      title: "ENGINE_ADS_UNAVAILABLE",
      status: 503,
      detail: "Engine ADS unavailable",
      instance: path,
      error_code: "ENGINE_ADS_UNAVAILABLE",
      trace_id: "trc_engine",
      request_id: "req_engine",
      retryable: true,
      field_errors: [],
      documentation_key: "engine.ads.unavailable",
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

function response<T>(body: T): EngineResponse<T> {
  return { status: 200, body };
}

function mutationCases() {
  return [
    ["POST", "/api/v1/ads/sources", { connector: "drive" }, 201],
    [
      "POST",
      `/api/v1/ads/sources/${sourceId}/actions/sync`,
      { full: true },
      202,
    ],
    [
      "POST",
      "/api/v1/ads/ingestion/uploads",
      { filename: "policy.pdf" },
      202,
    ],
    ["DELETE", `/api/v1/ads/documents/${documentId}`, undefined, 200],
    ["POST", "/api/v1/ads/knowledge", { title: "Policy" }, 201],
  ] as const;
}

function routeCases(): ReadonlyArray<
  readonly [method: string, url: string, body: unknown]
> {
  return [
    ["POST", "/api/v1/ads/sources", { connector: "drive" }],
    [
      "POST",
      `/api/v1/ads/sources/${sourceId}/actions/sync`,
      { full: true },
    ],
    [
      "POST",
      "/api/v1/ads/ingestion/uploads",
      { filename: "policy.pdf" },
    ],
    ["DELETE", `/api/v1/ads/documents/${documentId}`, undefined],
    ["POST", "/api/v1/ads/knowledge", { title: "Policy" }],
    ["GET", `/api/v1/ads/ingestion/jobs/${jobId}`, undefined],
    ["GET", "/api/v1/ads/documents", undefined],
    ["GET", `/api/v1/ads/documents/${documentId}`, undefined],
  ];
}

function engineErrorCases() {
  return [
    [
      "POST",
      "/api/v1/ads/sources",
      {},
      "/api/v1/ads/sources",
    ],
    [
      "POST",
      `/api/v1/ads/sources/${sourceId}/actions/sync`,
      {},
      `/api/v1/ads/sources/${sourceId}/actions/sync`,
    ],
    [
      "POST",
      "/api/v1/ads/ingestion/uploads",
      {},
      "/api/v1/ads/ingestion/uploads",
    ],
    [
      "GET",
      `/api/v1/ads/ingestion/jobs/${jobId}`,
      undefined,
      `/api/v1/ads/ingestion/jobs/${jobId}`,
    ],
    ["GET", "/api/v1/ads/documents", undefined, "/api/v1/ads/documents"],
    [
      "GET",
      `/api/v1/ads/documents/${documentId}`,
      undefined,
      `/api/v1/ads/documents/${documentId}`,
    ],
    [
      "DELETE",
      `/api/v1/ads/documents/${documentId}`,
      undefined,
      `/api/v1/ads/documents/${documentId}`,
    ],
    [
      "POST",
      "/api/v1/ads/knowledge",
      {},
      "/api/v1/ads/knowledge",
    ],
  ] as const;
}

function isMutation(method: string): boolean {
  return method !== "GET";
}

function expectProblem(
  responseValue: TestResponse,
  status: number,
  code: string,
): void {
  expect(responseValue.statusCode).toBe(status);
  expect(responseValue.headers["content-type"]).toContain(
    "application/problem+json",
  );
  expect(responseValue.json()).toMatchObject({
    status,
    error_code: code,
  });
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
