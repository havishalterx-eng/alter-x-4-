import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  WEBHOOK_SECRET_ROTATION_POLICY,
  WEBHOOK_SIGNATURE_ALGORITHM,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_PAYLOAD_TEMPLATE,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@alterx/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EngineClient,
  EngineExceptionFilter,
  EngineProblemError,
  type EnginePath,
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
import { RbacModule, type ActorContextType, type RbacRequest } from "../rbac";
import { TriggerBindingController } from "./trigger-binding.controller";
import { TriggerBindingService } from "./trigger-binding.service";
import { TriggerExceptionFilter } from "./trigger-exception.filter";

const uuid = "018f47a5-7b2c-7d10-8f11-123456789abc";
const triggerId = `trg_${uuid}`;
const bindingId = `tbn_${uuid}`;
const endpointId = `whe_${uuid}`;
const integrationId = uuid;
const tenantId = `ten_${uuid}`;
const workspaceId = `ws_${uuid}`;
const actor: ActorContextType = {
  user_id: `usr_${uuid}`,
  tenant_id: tenantId,
  workspace_id: workspaceId,
  session_id: "session-binding",
  auth_time: 1_700_000_000,
  roles: ["admin"],
  permissions: [
    "workflows:read",
    "workflows:write",
    "integrations:read",
    "integrations:write",
  ],
};

describe("Trigger integration binding BFF routes", () => {
  let app: NestFastifyApplication;
  const engine = new BindingEngine();
  const store = new MemoryIdempotencyStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [TriggerBindingController],
      providers: [
        {
          provide: TriggerBindingService,
          useFactory: () => new TriggerBindingService(engine as unknown as EngineClient),
        },
        TriggerExceptionFilter,
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

  it("relays binding lifecycle and secret-free endpoint metadata", async () => {
    const bound = await request("POST", `/api/v1/triggers/${triggerId}/bindings`, actor, {
      key: "bind-1",
      body: { integrationId, config: { eventTypes: ["invoice.created"] } },
    });
    expect(bound.statusCode).toBe(201);
    expect(bound.json()).toEqual(engine.binding);

    expect(
      (await request("GET", `/api/v1/triggers/${triggerId}/bindings`, actor)).json(),
    ).toEqual({ bindings: [engine.binding] });

    const endpoint = await request(
      "GET",
      `/api/v1/integrations/connections/${integrationId}/webhook`,
      actor,
    );
    expect(endpoint.json()).toEqual(engine.endpoint);
    expect(endpoint.headers.request_id).toBe("req_binding");
    expect(endpoint.headers.trace_id).toBe("trc_binding");
    expect(collectKeys(endpoint.json())).not.toEqual(
      expect.arrayContaining(["secret", "secretRef", "credential", "signingKey"]),
    );

    const disabled = await request(
      "DELETE",
      `/api/v1/triggers/${triggerId}/bindings/${bindingId}`,
      actor,
      { key: "disable-1" },
    );
    expect(disabled.json()).toMatchObject({ status: "disabled" });
    expect(engine.delete).toHaveBeenCalledWith(
      `/api/v1/triggers/${triggerId}/bindings/${bindingId}`,
      expect.objectContaining({ tenantId, workspaceId }),
      { idempotencyKey: "disable-1" },
    );
  });

  it("rotates through the real endpoint id with hard-cutover semantics and replay", async () => {
    const url = `/api/v1/integrations/connections/${integrationId}/webhook/rotate`;
    const first = await request("POST", url, actor, { key: "rotate-1", body: {} });
    const replay = await request("POST", url, actor, { key: "rotate-1", body: {} });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      endpointId,
      rotationPolicy: WEBHOOK_SECRET_ROTATION_POLICY,
    });
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(engine.get).toHaveBeenCalledWith(
      `/api/v1/integrations/${integrationId}/webhook-endpoint`,
      expect.objectContaining({ permissions: actor.permissions }),
    );
    expect(engine.post).toHaveBeenCalledWith(
      `/api/v1/webhook-endpoints/${endpointId}/actions/rotate-secret`,
      {},
      expect.objectContaining({ tenantId, workspaceId }),
      { idempotencyKey: "rotate-1" },
    );
    expect(engine.post).toHaveBeenCalledOnce();
  });

  it("scope-gates bind and restricts rotation to workspace admins", async () => {
    const readOnly = { ...actor, roles: ["viewer"], permissions: ["workflows:read"] };
    expectProblem(
      await request("POST", `/api/v1/triggers/${triggerId}/bindings`, readOnly, {
        key: "denied-bind",
        body: { integrationId, config: { eventTypes: ["invoice.created"] } },
      }),
      403,
      "RBAC_ROLE_DENIED",
    );
    expectProblem(
      await request(
        "POST",
        `/api/v1/integrations/connections/${integrationId}/webhook/rotate`,
        { ...actor, roles: ["editor"] },
        { key: "denied-rotate", body: {} },
      ),
      403,
      "RBAC_ROLE_DENIED",
    );
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("rejects malformed ids and binding bodies before Engine calls", async () => {
    expectProblem(
      await request("POST", `/api/v1/triggers/${triggerId}/bindings`, actor, {
        key: "invalid-body",
        body: { integrationId: "bad", config: { eventTypes: [] } },
      }),
      400,
      "INVALID_TRIGGER_BINDING_REQUEST",
    );
    expectProblem(
      await request("GET", "/api/v1/integrations/connections/bad/webhook", actor),
      400,
      "INVALID_TRIGGER_BINDING_REQUEST",
    );
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("passes Engine binding errors through as problem+json", async () => {
    engine.failNext("GET", `/api/v1/integrations/${integrationId}/webhook-endpoint`);
    const response = await request(
      "GET",
      `/api/v1/integrations/connections/${integrationId}/webhook`,
      actor,
    );
    expectProblem(response, 404, "ENGINE_WEBHOOK_ENDPOINT_NOT_FOUND");
  });

  it("does not duplicate Engine's public signed webhook receiver", async () => {
    expect(
      (
        await request(
          "POST",
          "/api/v1/webhooks/integrations/neighboring-guessed-token",
          undefined,
          { body: { event: "invoice.created" } },
        )
      ).statusCode,
    ).toBe(404);
  });

  it("default-denies direct calls and requires workspace context", async () => {
    const controller = new TriggerBindingController({
      list: vi.fn(),
    } as unknown as TriggerBindingService);
    await expect(
      controller.list(triggerId, undefined, undefined, {} as FastifyReply),
    ).rejects.toMatchObject({
      status: 401,
      response: { error_code: "AUTHENTICATION_REQUIRED" },
    });

    const { workspace_id: _workspace, ...withoutWorkspace } = actor;
    void _workspace;
    expect(() =>
      new TriggerBindingService(engine as unknown as EngineClient).endpoint(
        integrationId,
        withoutWorkspace,
        undefined,
      ),
    ).toThrowError(expect.objectContaining({
      status: 403,
      response: expect.objectContaining({ error_code: "TRIGGER_WORKSPACE_REQUIRED" }),
    }));
  });

  function request(
    method: "GET" | "POST" | "DELETE",
    url: string,
    requestActor?: ActorContextType,
    options: { key?: string; body?: unknown } = {},
  ): Promise<TestResponse> {
    return app.getHttpAdapter().getInstance().inject({
      method,
      url,
      headers: {
        ...(requestActor ? { "x-test-actor": JSON.stringify(requestActor) } : {}),
        ...(options.key ? { "idempotency-key": options.key } : {}),
      },
      ...(options.body === undefined ? {} : { payload: options.body }),
    } as never) as Promise<TestResponse>;
  }
});

class BindingEngine {
  readonly endpoint = {
    id: endpointId,
    tenantId,
    workspaceId,
    integrationId,
    url: `https://hooks.alter.ai/api/v1/webhooks/integrations/${"a".repeat(43)}`,
    signatureHeader: WEBHOOK_SIGNATURE_HEADER,
    timestampHeader: WEBHOOK_TIMESTAMP_HEADER,
    signatureAlgorithm: WEBHOOK_SIGNATURE_ALGORITHM,
    signaturePayloadTemplate: WEBHOOK_SIGNATURE_PAYLOAD_TEMPLATE,
    maxSkewSeconds: 300,
    activeSecretVersion: 1,
    secretRotatedAt: null,
    rotationPolicy: WEBHOOK_SECRET_ROTATION_POLICY,
    createdAt: "2026-08-06T12:00:00.000Z",
  };
  readonly binding = {
    id: bindingId,
    tenantId,
    workspaceId,
    triggerId,
    integrationId,
    webhookEndpointId: endpointId,
    config: { eventTypes: ["invoice.created"] },
    status: "active",
    createdAt: "2026-08-06T12:00:00.000Z",
    updatedAt: "2026-08-06T12:00:00.000Z",
  };
  readonly get = vi.fn(this.getResponse.bind(this));
  readonly post = vi.fn(this.postResponse.bind(this));
  readonly delete = vi.fn(this.deleteResponse.bind(this));
  private failure: { method: string; path: string } | undefined;

  reset(): void {
    this.failure = undefined;
    this.get.mockClear();
    this.post.mockClear();
    this.delete.mockClear();
  }

  failNext(method: string, path: string): void {
    this.failure = { method, path };
  }

  private async getResponse(path: EnginePath): Promise<EngineResponse<unknown>> {
    this.throwIfFailed("GET", path);
    return path.endsWith("/webhook-endpoint")
      ? {
          status: 200,
          body: this.endpoint,
          requestId: "req_binding",
          traceId: "trc_binding",
        }
      : { status: 200, body: { bindings: [this.binding] } };
  }

  private async postResponse(path: EnginePath): Promise<EngineResponse<unknown>> {
    this.throwIfFailed("POST", path);
    return path.endsWith("/rotate-secret")
      ? {
          status: 200,
          body: {
            endpointId,
            activeSecretVersion: 2,
            previousSecretVersion: 1,
            previousSecretInvalidatedAt: "2026-08-06T12:01:00.000Z",
            rotatedAt: "2026-08-06T12:01:00.000Z",
            rotationPolicy: WEBHOOK_SECRET_ROTATION_POLICY,
          },
        }
      : { status: 201, body: this.binding };
  }

  private async deleteResponse(path: EnginePath): Promise<EngineResponse<unknown>> {
    this.throwIfFailed("DELETE", path);
    return { status: 200, body: { ...this.binding, status: "disabled" } };
  }

  private throwIfFailed(method: string, path: string): void {
    if (this.failure?.method !== method || this.failure.path !== path) return;
    this.failure = undefined;
    throw new EngineProblemError({
      type: "https://errors.alter.ai/engine-webhook-endpoint-not-found",
      title: "ENGINE_WEBHOOK_ENDPOINT_NOT_FOUND",
      status: 404,
      detail: "Webhook endpoint not found",
      instance: path,
      error_code: "ENGINE_WEBHOOK_ENDPOINT_NOT_FOUND",
      trace_id: "trc_engine",
      request_id: "req_engine",
      retryable: false,
      field_errors: [],
      documentation_key: "engine.webhook-endpoint.not-found",
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
    const result = await operation();
    this.responses.set(key, { ...result, fingerprint: input.fingerprint });
    return { ...result, replayed: false };
  }
}

function expectProblem(response: TestResponse, status: number, code: string): void {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toMatchObject({ status, error_code: code });
}

interface TestResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  json(): unknown;
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
}
