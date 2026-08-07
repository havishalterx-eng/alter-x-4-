import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EngineClient,
  EngineExceptionFilter,
  EngineProblemError,
  type EngineCallerContext,
  type EnginePath,
  type EngineRequestBody,
  type EngineResponse,
} from "../../engine";
import {
  IdempotencyExceptionFilter,
  IdempotencyHttpError,
  IdempotencyInterceptor,
  PgIdempotencyStore,
  type IdempotencyExecution,
  type StoredHttpResponse,
} from "../../idempotency";
import { RbacModule, type ActorContextType, type RbacRequest } from "../../rbac";
import { VoiceController } from "./voice.controller";
import { VoiceExceptionFilter } from "./voice-exception.filter";
import { VoiceService } from "./voice.service";

const uuid = "018f47a5-7b2c-7d10-8f11-123456789abc";
const bindingId = `voc_${uuid}`;
const actor: ActorContextType = {
  user_id: `usr_${uuid}`,
  tenant_id: `ten_${uuid}`,
  workspace_id: `ws_${uuid}`,
  session_id: "session-voice",
  auth_time: 1_700_000_000,
  roles: ["admin"],
  permissions: ["integrations:read", "integrations:write"],
};
const readOnlyActor: ActorContextType = { ...actor, roles: ["viewer"], permissions: ["integrations:read"] };

const callHandling = { inbound_calls_enabled: true, voice_style: { language_tag: "en-IN" } };
const createBody = {
  workspace_id: actor.workspace_id,
  provider: "twilio" as const,
  phone_number: "+15551234567",
  credential_reference: "vault://twilio/acct-1",
  call_handling: callHandling,
};

describe("Voice channel routes", () => {
  let app: NestFastifyApplication;
  const engine = new VoiceEngine();
  const store = new MemoryIdempotencyStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [VoiceController],
      providers: [
        {
          provide: VoiceService,
          inject: [EngineClient],
          useFactory: (client: EngineClient) => new VoiceService(client),
        },
        VoiceExceptionFilter,
        IdempotencyInterceptor,
        IdempotencyExceptionFilter,
        { provide: EngineClient, useValue: engine },
        { provide: PgIdempotencyStore, useValue: store },
        { provide: APP_FILTER, useClass: EngineExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.getHttpAdapter().getInstance().addHook(
      "preHandler",
      (request: FastifyRequest, _reply: unknown, done: () => void) => {
        const value = request.headers["x-test-actor"];
        if (typeof value === "string") {
          (request as RbacRequest).actorContext = JSON.parse(value) as ActorContextType;
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

  it("relays and idempotently replays number binding exactly once", async () => {
    const options = {
      method: "POST",
      url: "/api/v1/channels/voice/numbers",
      body: createBody,
      actor,
      headers: { "idempotency-key": "bind-1" },
    };
    const first = await request(options);
    const second = await request(options);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(engine.post).toHaveBeenCalledTimes(1);
    expect(engine.post).toHaveBeenCalledWith(
      "/api/v1/channels/voice/numbers",
      createBody,
      expect.objectContaining({ tenantId: actor.tenant_id, workspaceId: actor.workspace_id }),
      { idempotencyKey: "bind-1" },
    );
    expect(JSON.stringify(first.json())).not.toContain("acct-1");
  });

  it("relays and idempotently replays call initiation exactly once, never doubling a real call", async () => {
    const body = { voice_account_id: bindingId, to_phone_number: "+15559876543" };
    const options = {
      method: "POST",
      url: "/api/v1/channels/voice/calls",
      body,
      actor,
      headers: { "idempotency-key": "call-1" },
    };
    const first = await request(options);
    const second = await request(options);

    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual(engine.callResponse);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(engine.post).toHaveBeenCalledTimes(1);
  });

  it("relays the initiate-call response opaquely without a synthesized VoiceCall shape", async () => {
    const body = { voice_account_id: bindingId, to_phone_number: "+15559876543" };
    const result = await request({
      method: "POST",
      url: "/api/v1/channels/voice/calls",
      body,
      actor,
      headers: { "idempotency-key": "call-2" },
    });
    expect(result.json()).toEqual({ provider_call_reference: "CA123", status: "queued" });
    expect(result.json()).not.toHaveProperty("voice_account_id");
    expect(result.json()).not.toHaveProperty("from_phone_number");
  });

  it("relays list pagination through the query string", async () => {
    const result = await request({
      method: "GET",
      url: "/api/v1/channels/voice/numbers?cursor=next%2Fpage&limit=25",
      actor,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(engine.listResponse);
    expect(engine.get).toHaveBeenCalledWith(
      "/api/v1/channels/voice/numbers?cursor=next%2Fpage&limit=25",
      expect.any(Object),
    );
  });

  it("relays capabilities and health reads", async () => {
    const capabilities = await request({
      method: "GET",
      url: `/api/v1/channels/voice/numbers/${bindingId}/capabilities`,
      actor,
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toEqual(engine.capabilitiesResponse);

    const health = await request({
      method: "GET",
      url: `/api/v1/channels/voice/numbers/${bindingId}/health`,
      actor,
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual(engine.healthResponse);
  });

  it("passes the client's If-Match token through to Engine and surfaces a stale-match 412", async () => {
    const fresh = await request({
      method: "PATCH",
      url: `/api/v1/channels/voice/numbers/${bindingId}/call-handling`,
      body: { call_handling: callHandling },
      actor,
      headers: { "idempotency-key": "handling-1", "if-match": '"fresh-etag"' },
    });
    expect(fresh.statusCode).toBe(200);
    expect(engine.patch).toHaveBeenCalledWith(
      `/api/v1/channels/voice/numbers/${bindingId}/call-handling`,
      { call_handling: callHandling },
      expect.any(Object),
      { idempotencyKey: "handling-1", ifMatch: '"fresh-etag"' },
    );

    engine.failNextWithStaleEtag();
    const stale = await request({
      method: "PATCH",
      url: `/api/v1/channels/voice/numbers/${bindingId}/call-handling`,
      body: { call_handling: callHandling },
      actor,
      headers: { "idempotency-key": "handling-2", "if-match": '"stale-etag"' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.headers["content-type"]).toContain("application/problem+json");
  });

  it("rejects a call-handling update missing If-Match before reaching Engine", async () => {
    const result = await request({
      method: "PATCH",
      url: `/api/v1/channels/voice/numbers/${bindingId}/call-handling`,
      body: { call_handling: callHandling },
      actor,
      headers: { "idempotency-key": "handling-3" },
    });
    expect(result.statusCode).toBe(428);
    expect(engine.patch).not.toHaveBeenCalled();
  });

  it("relays real Engine errors as problem+json without reshaping them", async () => {
    engine.failNextWithUpstreamError();
    const result = await request({
      method: "GET",
      url: `/api/v1/channels/voice/numbers/${bindingId}/health`,
      actor,
    });
    expect(result.statusCode).toBe(502);
    expect(result.headers["content-type"]).toContain("application/problem+json");
  });

  it("rejects invalid request bodies with a validation problem before touching Engine", async () => {
    const result = await request({
      method: "POST",
      url: "/api/v1/channels/voice/numbers",
      body: { ...createBody, phone_number: "not-e164" },
      actor,
      headers: { "idempotency-key": "invalid-1" },
    });
    expect(result.statusCode).toBe(400);
    expect(result.json()).toMatchObject({ error_code: "VOICE_VALIDATION_FAILED" });
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("denies reads and writes to actors lacking the required role or permission", async () => {
    const denied = await request({
      method: "POST",
      url: "/api/v1/channels/voice/numbers",
      body: createBody,
      actor: readOnlyActor,
      headers: { "idempotency-key": "denied-1" },
    });
    expect(denied.statusCode).toBe(403);
    expect(engine.post).not.toHaveBeenCalled();

    const readAllowed = await request({
      method: "GET",
      url: "/api/v1/channels/voice/numbers",
      actor: readOnlyActor,
    });
    expect(readAllowed.statusCode).toBe(200);
  });

  it("denies call-handling updates to a read-only actor and never reaches Engine", async () => {
    const result = await request({
      method: "PATCH",
      url: `/api/v1/channels/voice/numbers/${bindingId}/call-handling`,
      body: { call_handling: callHandling },
      actor: readOnlyActor,
      headers: { "idempotency-key": "denied-2", "if-match": '"etag-1"' },
    });
    expect(result.statusCode).toBe(403);
    expect(engine.patch).not.toHaveBeenCalled();
  });

  it("denies call initiation to a read-only actor and never places the call", async () => {
    const result = await request({
      method: "POST",
      url: "/api/v1/channels/voice/calls",
      body: { voice_account_id: bindingId, to_phone_number: "+15559876543" },
      actor: readOnlyActor,
      headers: { "idempotency-key": "denied-3" },
    });
    expect(result.statusCode).toBe(403);
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("never leaks the raw credential_reference into a response or an Engine call log", async () => {
    const result = await request({
      method: "POST",
      url: "/api/v1/channels/voice/numbers",
      body: createBody,
      actor,
      headers: { "idempotency-key": "no-leak-1" },
    });
    expect(JSON.stringify(result.json())).not.toContain(createBody.credential_reference);
    expect(JSON.stringify(engine.post.mock.results)).not.toContain(createBody.credential_reference);
  });

  function request(options: {
    method: string;
    url: string;
    body?: unknown;
    actor?: ActorContextType;
    headers?: Record<string, string>;
  }) {
    return app.getHttpAdapter().getInstance().inject({
      method: options.method,
      url: options.url,
      payload: options.body as never,
      headers: {
        ...(options.actor ? { "x-test-actor": JSON.stringify(options.actor) } : {}),
        ...options.headers,
      },
    } as never) as Promise<{
      statusCode: number;
      headers: Record<string, string | string[] | undefined>;
      json(): unknown;
    }>;
  }
});

class VoiceEngine {
  readonly bindingResponse = {
    id: bindingId,
    workspace_id: actor.workspace_id,
    provider: "twilio",
    phone_number: "+15551234567",
    status: "pending",
    call_handling: callHandling,
    created_at: "2026-08-04T08:00:00Z",
    updated_at: "2026-08-04T08:00:00Z",
  };
  readonly callResponse = { provider_call_reference: "CA123", status: "queued" };
  readonly listResponse = {
    data: [this.bindingResponse],
    page: { next_cursor: "next-engine", has_more: true, limit: 25 },
  };
  readonly capabilitiesResponse = {
    supports_inbound_calls: true,
    supports_outbound_calls: true,
    supports_status_callbacks: false,
    supported_languages: ["en-IN"],
    supported_voice_styles: ["calm"],
  };
  readonly healthResponse = { status: "healthy", checked_at: "2026-08-04T08:00:00Z", latency_ms: 12 };

  readonly get = vi.fn(this.getResponse.bind(this));
  readonly post = vi.fn(this.postResponse.bind(this));
  readonly patch = vi.fn(this.patchResponse.bind(this));
  private staleEtagNext = false;
  private upstreamErrorNext = false;

  reset(): void {
    this.get.mockClear();
    this.post.mockClear();
    this.patch.mockClear();
    this.staleEtagNext = false;
    this.upstreamErrorNext = false;
  }

  failNextWithStaleEtag(): void {
    this.staleEtagNext = true;
  }

  failNextWithUpstreamError(): void {
    this.upstreamErrorNext = true;
  }

  private async getResponse<T>(path: EnginePath): Promise<EngineResponse<T>> {
    if (this.upstreamErrorNext) {
      this.upstreamErrorNext = false;
      throw new EngineProblemError({
        type: "https://errors.alter.ai/upstream-service-error",
        title: "Upstream service error",
        status: 502,
        detail: "Upstream service request failed.",
        instance: path,
        error_code: "UPSTREAM_SERVICE_ERROR",
        trace_id: "trc_test",
        request_id: "req_test",
        retryable: true,
        field_errors: [],
        documentation_key: "upstream.service-error",
      });
    }
    if (path.endsWith("/capabilities")) {
      return response(this.capabilitiesResponse as unknown as T);
    }
    if (path.endsWith("/health")) {
      return response(this.healthResponse as unknown as T);
    }
    if (/^\/api\/v1\/channels\/voice\/numbers\/[^/?]+$/.test(path)) {
      return response(this.bindingResponse as unknown as T);
    }
    return response(this.listResponse as unknown as T);
  }

  private async postResponse<T>(path: EnginePath, body: EngineRequestBody): Promise<EngineResponse<T>> {
    if (path === "/api/v1/channels/voice/calls") {
      return { status: 202, body: this.callResponse as unknown as T };
    }
    return { status: 201, body: { ...this.bindingResponse, ...(typeof body === "object" ? {} : {}) } as unknown as T };
  }

  private async patchResponse<T>(
    path: EnginePath,
    _body: EngineRequestBody,
    _context: EngineCallerContext,
    options: { ifMatch?: string },
  ): Promise<EngineResponse<T>> {
    if (this.staleEtagNext) {
      this.staleEtagNext = false;
      throw new EngineProblemError({
        type: "https://errors.alter.ai/etag-mismatch",
        title: "ETAG_MISMATCH",
        status: 412,
        detail: "Resource changed since it was read.",
        instance: path,
        error_code: "ETAG_MISMATCH",
        trace_id: "trc_test",
        request_id: "req_test",
        retryable: false,
        field_errors: [],
        documentation_key: "etag.mismatch",
      });
    }
    void options;
    return response(this.bindingResponse as unknown as T);
  }
}

class MemoryIdempotencyStore {
  private readonly responses = new Map<string, StoredHttpResponse & { fingerprint: string }>();

  clear(): void {
    this.responses.clear();
  }

  async execute(input: IdempotencyExecution, operation: () => Promise<StoredHttpResponse>) {
    if (!input.key) {
      throw new IdempotencyHttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header required", input.instance);
    }
    const mapKey = `${input.tenantId}:${input.key}`;
    const stored = this.responses.get(mapKey);
    if (stored) {
      if (stored.fingerprint !== input.fingerprint) {
        throw new IdempotencyHttpError(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different request", input.instance);
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
