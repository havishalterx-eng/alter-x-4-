import type { JsonValue } from "@alterx/shared-clients";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
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
import {
  RbacModule,
  type ActorContextType,
  type RbacRequest,
} from "../rbac";
import { CredentialController } from "./credential.controller";
import { CredentialEtagResolver } from "./credential-etag.resolver";
import { CredentialExceptionFilter } from "./credential-exception.filter";
import { CredentialRepository } from "./credential.repository";
import { CredentialService } from "./credential.service";
import { CREDENTIAL_SECRETS_PROVIDER } from "./tokens";
import type { CredentialRecord } from "./types";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const actor: ActorContextType = {
  user_id: "018f47a5-7b2c-7d10-8f11-123456789abd",
  tenant_id: tenantId,
  session_id: "session",
  roles: ["admin"],
  permissions: ["credential:read", "credential:write", "credential:delete"],
};
const plaintext = "plain-never-leaks-7654";

describe("credential routes", () => {
  let app: NestFastifyApplication;
  let credentialService: CredentialService;
  const repository = new MemoryCredentialRepository();
  const provider = new MemorySecretsProvider();
  const store = new MemoryIdempotencyStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [CredentialController],
      providers: [
        CredentialService,
        CredentialEtagResolver,
        CredentialExceptionFilter,
        IdempotencyInterceptor,
        IdempotencyExceptionFilter,
        IfMatchGuard,
        EtagResponseInterceptor,
        ConcurrencyExceptionFilter,
        { provide: CredentialRepository, useValue: repository },
        { provide: CREDENTIAL_SECRETS_PROVIDER, useValue: provider },
        { provide: PgIdempotencyStore, useValue: store },
        {
          provide: ETAG_RESOURCE_RESOLVER,
          useExisting: CredentialEtagResolver,
        },
      ],
    }).compile();
    credentialService = moduleRef.get(CredentialService);
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

  it("keeps plaintext out of every route response and log", async () => {
    const rotated = "rotated-secret-4321";
    const submittedSecrets = [plaintext, rotated];
    const logs: unknown[][] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );
    const responses: string[] = [];
    try {
      const created = await request("POST", "/api/v1/credentials", actor, {
        headers: { "idempotency-key": "create-1" },
        payload: {
          name: "Production DB",
          connector: "postgres",
          scope: "deploy",
          value: plaintext,
        },
      });
      responses.push(created.body);
      expect(created.statusCode).toBe(201);
      expect(provider.values()).toEqual([plaintext]);

      const id = (created.json() as { id: string }).id;
      responses.push((await request("GET", "/api/v1/credentials", actor)).body);
      const detail = await request("GET", `/api/v1/credentials/${id}`, actor);
      responses.push(detail.body);
      const patched = await request(
        "PATCH",
        `/api/v1/credentials/${id}`,
        actor,
        {
          headers: {
            "idempotency-key": "rotate-1",
            "if-match": String(detail.headers.etag),
          },
          payload: { value: rotated },
        },
      );
      responses.push(patched.body);
      expect(provider.values()).toEqual([rotated]);

      // Internal resolve returns plaintext to its trusted caller, never an HTTP body.
      await expect(
        credentialService.resolve(tenantId, id, "deploy", actor.user_id),
      ).resolves.toBe(rotated);

      const removed = await request(
        "DELETE",
        `/api/v1/credentials/${id}`,
        actor,
        { headers: { "idempotency-key": "delete-exit-check" } },
      );
      responses.push(removed.body);

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

  it("replays create without writing the provider twice", async () => {
    const options = {
      headers: { "idempotency-key": "same-create" },
      payload: {
        name: "DB",
        connector: "postgres",
        scope: "deploy",
        value: plaintext,
      },
    };
    const first = await request("POST", "/api/v1/credentials", actor, options);
    const second = await request("POST", "/api/v1/credentials", actor, options);
    expect(second.json()).toEqual(first.json());
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(provider.putCount).toBe(1);
  });

  it("rejects stale If-Match and wrong scope", async () => {
    const created = await request("POST", "/api/v1/credentials", actor, {
      headers: { "idempotency-key": "create-2" },
      payload: {
        name: "DB",
        connector: "postgres",
        scope: "deploy",
        value: plaintext,
      },
    });
    const id = (created.json() as { id: string }).id;
    const stale = await request("PATCH", `/api/v1/credentials/${id}`, actor, {
      headers: {
        "idempotency-key": "patch-stale",
        "if-match": '"stale"',
      },
      payload: { name: "Changed" },
    });
    expect(stale.statusCode).toBe(412);

    const denied = await request("GET", "/api/v1/credentials", {
      ...actor,
      permissions: [],
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers["content-type"]).toContain("application/problem+json");
  });

  it("validates input and deletes provider plus reference", async () => {
    const invalid = await request("POST", "/api/v1/credentials", actor, {
      headers: { "idempotency-key": "invalid" },
      payload: {
        name: "DB",
        connector: "postgres",
        scope: "deploy",
        value: "   ",
      },
    });
    expect(invalid.statusCode).toBe(400);

    const created = await request("POST", "/api/v1/credentials", actor, {
      headers: { "idempotency-key": "create-3" },
      payload: {
        name: "DB",
        connector: "postgres",
        scope: "deploy",
        value: plaintext,
      },
    });
    const id = (created.json() as { id: string }).id;
    const removed = await request(
      "DELETE",
      `/api/v1/credentials/${id}`,
      actor,
      { headers: { "idempotency-key": "delete-1" } },
    );
    expect(removed.statusCode).toBe(204);
    expect(repository.records.size).toBe(0);
    expect(provider.values()).toHaveLength(0);
  });

  async function request(
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

class MemoryCredentialRepository {
  readonly records = new Map<string, CredentialRecord>();

  async create(
    tenant: string,
    id: string,
    input: { name: string; connector: string; scope: string },
    last4: string,
  ): Promise<CredentialRecord> {
    const now = new Date("2026-07-26T12:00:00.000Z");
    const record = {
      tenantId: tenant,
      id,
      ...input,
      last4,
      useAuditPtr: null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(id, record);
    return record;
  }

  async list(): Promise<CredentialRecord[]> {
    return [...this.records.values()];
  }

  async find(_tenant: string, id: string): Promise<CredentialRecord | undefined> {
    return this.records.get(id);
  }

  async update(
    _tenant: string,
    id: string,
    input: Partial<Pick<CredentialRecord, "name" | "connector" | "scope">>,
    last4?: string,
  ): Promise<CredentialRecord | undefined> {
    const current = this.records.get(id);
    if (!current) return undefined;
    const updated = {
      ...current,
      ...input,
      ...(last4 === undefined ? {} : { last4 }),
      updatedAt: new Date(current.updatedAt.getTime() + 1_000),
    };
    this.records.set(id, updated);
    return updated;
  }

  async delete(_tenant: string, id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async recordUse(): Promise<string> {
    return crypto.randomUUID();
  }

  clear(): void {
    this.records.clear();
  }
}

class MemorySecretsProvider {
  readonly secrets = new Map<string, string>();
  putCount = 0;

  async putSecret(reference: string, value: string): Promise<void> {
    this.putCount += 1;
    this.secrets.set(reference, value);
  }

  async getSecret(reference: string): Promise<string> {
    return this.secrets.get(reference)!;
  }

  async deleteSecret(reference: string): Promise<void> {
    this.secrets.delete(reference);
  }

  values(): string[] {
    return [...this.secrets.values()];
  }

  clear(): void {
    this.secrets.clear();
    this.putCount = 0;
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
      return {
        status: existing.status,
        body: existing.body,
        replayed: true,
      };
    }
    const response = await operation();
    this.responses.set(key, { ...response, fingerprint: execution.fingerprint });
    return { ...response, replayed: false };
  }

  clear(): void {
    this.responses.clear();
  }
}
