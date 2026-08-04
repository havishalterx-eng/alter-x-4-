import type { JsonValue } from "@alterx/shared-clients";
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
  ConcurrencyExceptionFilter,
  ETAG_RESOURCE_RESOLVER,
  EtagResponseInterceptor,
  IfMatchGuard,
} from "../concurrency";
import {
  IdempotencyExceptionFilter,
  IdempotencyHttpError,
  IdempotencyInterceptor,
  PgIdempotencyStore,
  type IdempotencyExecution,
  type StoredHttpResponse,
} from "../idempotency";
import { RbacModule, type ActorContextType, type RbacRequest } from "../rbac";
import { EnvVarController } from "./env-var.controller";
import { EnvVarEtagResolver } from "./env-var-etag.resolver";
import { EnvVarExceptionFilter } from "./env-var-exception.filter";
import { EnvVarRepository } from "./env-var.repository";
import { EnvVarService } from "./env-var.service";
import { ENV_VAR_SECRETS_PROVIDER } from "./tokens";
import type { EnvVarRecord } from "./types";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const baseUrl = `/api/v1/projects/${projectId}/env-vars`;
const admin: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abd",
  tenant_id: tenantId,
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session-admin",
  roles: ["admin"],
  permissions: ["projects:read", "projects:write"],
};
const member: ActorContextType = {
  ...admin,
  session_id: "session-viewer",
  roles: ["viewer"],
  permissions: ["projects:read"],
};
const plaintext = "initial-env-secret-7654";

describe("project environment variable routes", () => {
  let app: NestFastifyApplication;
  let envVarService: EnvVarService;
  const repository = new MemoryEnvVarRepository();
  const provider = new MemorySecretsProvider();
  const store = new MemoryIdempotencyStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [EnvVarController],
      providers: [
        EnvVarService,
        EnvVarEtagResolver,
        EnvVarExceptionFilter,
        IdempotencyInterceptor,
        IdempotencyExceptionFilter,
        IfMatchGuard,
        EtagResponseInterceptor,
        ConcurrencyExceptionFilter,
        { provide: EnvVarRepository, useValue: repository },
        { provide: ENV_VAR_SECRETS_PROVIDER, useValue: provider },
        { provide: PgIdempotencyStore, useValue: store },
        {
          provide: ETAG_RESOURCE_RESOLVER,
          useExisting: EnvVarEtagResolver,
        },
      ],
    }).compile();
    envVarService = moduleRef.get(EnvVarService);
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.getHttpAdapter().getInstance().addHook(
      "preHandler",
      (request: FastifyRequest, _reply: unknown, done: () => void) => {
        const encoded = request.headers["x-test-actor"];
        if (typeof encoded === "string") {
          (request as RbacRequest).actorContext = JSON.parse(
            encoded,
          ) as ActorContextType;
        }
        done();
      },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    repository.clear();
    provider.clear();
    store.clear();
  });

  afterAll(async () => app.close());

  it("keeps every submitted value out of responses and logs", async () => {
    const rotated = "rotated-env-secret-4321";
    const submittedSecrets = [plaintext, rotated];
    const logs: unknown[][] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );
    const responses: string[] = [];
    try {
      const created = await request("POST", baseUrl, admin, {
        headers: { "idempotency-key": "env-create-exit" },
        payload: {
          environment: "production",
          key: "DATABASE_URL",
          value: plaintext,
        },
      });
      responses.push(created.body);
      expect(created.statusCode).toBe(201);
      expect(provider.values()).toEqual([plaintext]);
      expect(created.json()).toMatchObject({
        project_id: projectId,
        environment: "production",
        key: "DATABASE_URL",
        last4: "****7654",
      });
      expect(created.json()).not.toHaveProperty("value");

      const id = (created.json() as { id: string }).id;
      const listed = await request("GET", baseUrl, member);
      responses.push(listed.body);
      expect(listed.json()).toEqual([created.json()]);
      const detail = await request("GET", `${baseUrl}/${id}`, member);
      responses.push(detail.body);
      expect(detail.json()).toEqual(created.json());
      expect(detail.headers.etag).toBeTypeOf("string");

      const patched = await request("PATCH", `${baseUrl}/${id}`, admin, {
        headers: {
          "idempotency-key": "env-rotate-exit",
          "if-match": String(detail.headers.etag),
        },
        payload: { value: rotated },
      });
      responses.push(patched.body);
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toMatchObject({ last4: "****4321" });
      expect(provider.values()).toEqual([rotated]);
      expect(provider.values()).not.toContain(plaintext);

      await expect(
        envVarService.resolve(tenantId, projectId, id, admin.user_id),
      ).resolves.toBe(rotated);
      expect(repository.audits).toHaveLength(1);

      const removed = await request("DELETE", `${baseUrl}/${id}`, admin, {
        headers: { "idempotency-key": "env-delete-exit" },
      });
      responses.push(removed.body);
      expect(removed.statusCode).toBe(204);
      expect(provider.values()).toHaveLength(0);
      expect(repository.records.size).toBe(0);

      const responseOutput = JSON.stringify(responses);
      const logOutput = JSON.stringify(logs);
      for (const submittedSecret of submittedSecrets) {
        expect(responseOutput).not.toContain(submittedSecret);
        expect(logOutput).not.toContain(submittedSecret);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("replays create without writing SecretsProvider twice", async () => {
    const options = {
      headers: { "idempotency-key": "same-env-create" },
      payload: {
        environment: "production",
        key: "DATABASE_URL",
        value: plaintext,
      },
    };
    const first = await request("POST", baseUrl, admin, options);
    const second = await request("POST", baseUrl, admin, options);
    expect(second.json()).toEqual(first.json());
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(provider.putCount).toBe(1);
  });

  it("requires current If-Match for rotation", async () => {
    const created = await create();
    const id = (created.json() as { id: string }).id;
    const missing = await request("PATCH", `${baseUrl}/${id}`, admin, {
      headers: { "idempotency-key": "env-patch-missing" },
      payload: { value: "missing-match-1111" },
    });
    expect(missing.statusCode).toBe(428);
    expect(missing.headers["content-type"]).toContain("application/problem+json");

    const stale = await request("PATCH", `${baseUrl}/${id}`, admin, {
      headers: {
        "idempotency-key": "env-patch-stale",
        "if-match": '"stale"',
      },
      payload: { value: "stale-match-2222" },
    });
    expect(stale.statusCode).toBe(412);
    expect(provider.putCount).toBe(1);
  });

  it("scope-gates writes before SecretsProvider and permits member reads", async () => {
    const denied = await request("POST", baseUrl, member, {
      headers: { "idempotency-key": "env-denied" },
      payload: {
        environment: "production",
        key: "DATABASE_URL",
        value: plaintext,
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers["content-type"]).toContain("application/problem+json");
    expect(provider.putCount).toBe(0);

    const created = await create();
    expect((await request("GET", baseUrl, member)).statusCode).toBe(200);
    const id = (created.json() as { id: string }).id;
    const deleteDenied = await request("DELETE", `${baseUrl}/${id}`, member, {
      headers: { "idempotency-key": "env-delete-denied" },
    });
    expect(deleteDenied.statusCode).toBe(403);
    expect(provider.deleteCount).toBe(0);
  });

  it("validates project, key, value, and requires idempotency keys", async () => {
    const invalid = await request("POST", baseUrl, admin, {
      headers: { "idempotency-key": "env-invalid" },
      payload: {
        environment: "production",
        key: "BAD-KEY",
        value: "   ",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers["content-type"]).toContain("application/problem+json");

    const missingKey = await request("POST", baseUrl, admin, {
      payload: {
        environment: "production",
        key: "DATABASE_URL",
        value: plaintext,
      },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(provider.putCount).toBe(0);

    const badProject = await request(
      "GET",
      "/api/v1/projects/project-bad/env-vars",
      member,
    );
    expect(badProject.statusCode).toBe(400);
  });

  function create() {
    return request("POST", baseUrl, admin, {
      headers: { "idempotency-key": `env-create-${crypto.randomUUID()}` },
      payload: {
        environment: "production",
        key: "DATABASE_URL",
        value: plaintext,
      },
    });
  }

  function request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    requestActor: ActorContextType,
    options: {
      headers?: Record<string, string>;
      payload?: Record<string, JsonValue>;
    } = {},
  ) {
    return app.inject({
      method,
      url,
      headers: {
        "x-test-actor": JSON.stringify(requestActor),
        ...options.headers,
      },
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    });
  }
});

class MemoryEnvVarRepository {
  readonly records = new Map<string, EnvVarRecord>();
  readonly audits: string[] = [];

  async create(
    tenant: string,
    id: string,
    project: string,
    input: { environment: string; key: string },
    last4: string,
  ): Promise<EnvVarRecord> {
    const now = new Date("2026-08-04T12:00:00.000Z");
    const record = {
      tenantId: tenant,
      id,
      projectId: project,
      ...input,
      last4,
      useAuditPtr: null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(id, record);
    return record;
  }

  async list(_tenant: string, project: string): Promise<EnvVarRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.projectId === project,
    );
  }

  async find(
    _tenant: string,
    project: string,
    id: string,
  ): Promise<EnvVarRecord | undefined> {
    const record = this.records.get(id);
    return record?.projectId === project ? record : undefined;
  }

  async update(
    _tenant: string,
    project: string,
    id: string,
    input: Partial<Pick<EnvVarRecord, "environment" | "key">>,
    last4?: string,
  ): Promise<EnvVarRecord | undefined> {
    const current = this.records.get(id);
    if (!current || current.projectId !== project) return undefined;
    const updated = {
      ...current,
      ...input,
      ...(last4 === undefined ? {} : { last4 }),
      updatedAt: new Date(current.updatedAt.getTime() + 1_000),
    };
    this.records.set(id, updated);
    return updated;
  }

  async delete(_tenant: string, project: string, id: string): Promise<boolean> {
    const current = this.records.get(id);
    return current?.projectId === project && this.records.delete(id);
  }

  async recordUse(_tenant: string, id: string, actorId: string): Promise<string> {
    const auditId = crypto.randomUUID();
    this.audits.push(`${id}:${actorId}:${auditId}`);
    return auditId;
  }

  clear(): void {
    this.records.clear();
    this.audits.length = 0;
  }
}

class MemorySecretsProvider {
  readonly secrets = new Map<string, string>();
  putCount = 0;
  deleteCount = 0;

  async putSecret(reference: string, value: string): Promise<void> {
    this.putCount += 1;
    this.secrets.set(reference, value);
  }

  async getSecret(reference: string): Promise<string> {
    return this.secrets.get(reference)!;
  }

  async deleteSecret(reference: string): Promise<void> {
    this.deleteCount += 1;
    this.secrets.delete(reference);
  }

  values(): string[] {
    return [...this.secrets.values()];
  }

  clear(): void {
    this.secrets.clear();
    this.putCount = 0;
    this.deleteCount = 0;
  }
}

class MemoryIdempotencyStore {
  private readonly responses = new Map<
    string,
    StoredHttpResponse & { fingerprint: string }
  >();

  async execute(
    execution: IdempotencyExecution,
    operation: () => Promise<StoredHttpResponse>,
  ) {
    if (!execution.key) {
      throw new IdempotencyHttpError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key header required",
        execution.instance,
      );
    }
    const key = `${execution.tenantId}:${execution.key}`;
    const existing = this.responses.get(key);
    if (existing) {
      return { status: existing.status, body: existing.body, replayed: true };
    }
    const response = await operation();
    this.responses.set(key, { ...response, fingerprint: execution.fingerprint });
    return { ...response, replayed: false };
  }

  clear(): void {
    this.responses.clear();
  }
}
