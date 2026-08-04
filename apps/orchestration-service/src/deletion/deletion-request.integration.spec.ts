import {
  createSign,
  generateKeyPairSync,
  randomBytes,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { resolve } from "node:path";

import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";
import {
  ActorTokenValidator,
  M2mValidator,
  RedisReplayStore,
  RedisRespSetClient,
  SessionGatewayGuard,
} from "@alterx/auth";
import { ProblemDetailsSchema } from "@alterx/contracts";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DeletionRequestController } from "./deletion-request.controller";
import { OrchestrationDeletionService } from "./deletion.service";

const migrationsFolder = resolve(process.cwd(), "apps/orchestration-service/drizzle");
const TENANT_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const TENANT_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b1";

describe.sequential("actor-scoped deletion request", () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let admin: PostgresOrchestrationStoreProvider;
  let tenantStore: PostgresOrchestrationStoreProvider;
  let app: NestFastifyApplication;
  let baseUrl: string;
  let privateKey: KeyObject;
  const role = `deletion_request_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer("postgres:16.6-alpine")
        .withDatabase("orchestration_db")
        .withUsername("orchestration_admin")
        .withPassword(randomBytes(24).toString("hex"))
        .start(),
      new RedisContainer("redis:7.4.2-alpine").start(),
    ]);
    admin = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: postgres.getConnectionUri(),
      migrationsFolder,
    });
    await admin.migrate();
    await admin.withTenant(TENANT_A, async (tx) => {
      await tx.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      await tx.query("GRANT CONNECT ON DATABASE orchestration_db TO " + role);
      await tx.query("GRANT USAGE ON SCHEMA public TO " + role);
      await tx.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO " + role);
    });
    tenantStore = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: `postgresql://${role}:${password}@${postgres.getHost()}:${postgres.getPort()}/${postgres.getDatabase()}`,
      migrationsFolder,
    });
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    privateKey = pair.privateKey;
    const jwk: JsonWebKey = {
      ...pair.publicKey.export({ format: "jwk" }),
      kid: "deletion-request-key",
      alg: "RS256",
      use: "sig",
    };
    const fetchJwks = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
    const guard = new SessionGatewayGuard(
      new M2mValidator(
        { auth0Domain: "auth.test", apiAudience: "alter-engine" },
        { fetch: fetchJwks },
      ),
      new ActorTokenValidator(
        {
          issuer: "alter-platform-api.identity-broker",
          audience: "alter-engine",
          jwksUrl: "https://identity.test/jwks",
        },
        new RedisReplayStore(new RedisRespSetClient(redis.getConnectionUrl())),
        { fetch: fetchJwks },
      ),
      tenantStore,
    );
    const module = await Test.createTestingModule({
      controllers: [DeletionRequestController],
      providers: [
        {
          provide: OrchestrationDeletionService,
          useValue: new OrchestrationDeletionService(tenantStore, admin),
        },
        { provide: APP_GUARD, useValue: guard },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await tenantStore?.close();
    await admin?.withTenant(TENANT_A, async (tx) => {
      await tx.query(`DROP OWNED BY ${role}`);
      await tx.query(`DROP ROLE IF EXISTS ${role}`);
    });
    await admin?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  }, 60_000);

  it("deletes actor tenant only when request body attempts a cross-tenant override", async () => {
    await Promise.all([
      seedWorkflow(TENANT_A, "wf_actor_tenant"),
      seedWorkflow(TENANT_B, "wf_other_tenant"),
    ]);

    const response = await fetch(`${baseUrl}/api/v1/deletion-requests`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt(machineClaims())}`,
        "content-type": "application/json",
        "x-alter-actor-token": jwt(actorClaims(`ten_${TENANT_A}`)),
      },
      body: JSON.stringify({ tenantId: `ten_${TENANT_B}` }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      store: "orchestration-service",
      manifestId: expect.stringMatching(/^del_[0-9a-f-]{36}$/),
      deleted: true,
      remaining: [],
    });
    await expect(workflowCount(TENANT_A)).resolves.toBe(0);
    await expect(workflowCount(TENANT_B)).resolves.toBe(1);
  });

  it("rejects missing authentication before deletion", async () => {
    const response = await fetch(`${baseUrl}/api/v1/deletion-requests`, { method: "POST" });
    expect(response.status).toBe(401);
    expect(ProblemDetailsSchema.parse(await response.json()).status).toBe(401);
  });

  async function seedWorkflow(tenantId: string, workflowId: string): Promise<void> {
    await admin.withTenant(tenantId, async (tx) => {
      await tx.query(
        "INSERT INTO workflows(id,tenant_id,workspace_id,name) VALUES ($1,$2,$2,'deletion fixture')",
        [workflowId, tenantId],
      );
    });
  }

  async function workflowCount(tenantId: string): Promise<number> {
    return admin.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM workflows WHERE tenant_id=$1",
        [tenantId],
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  function jwt(claims: Record<string, unknown>): string {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", kid: "deletion-request-key", typ: "JWT" })}.${encode(claims)}`;
    return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
  }
});

function machineClaims(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1_000);
  return { iss: "https://auth.test/", aud: "alter-engine", iat: now, exp: now + 60 };
}

function actorClaims(tenantId: string): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1_000);
  return {
    user_id: "usr_018f4d6e-2b4a-7a3e-8c1a-1234567890a5",
    tenant_id: tenantId,
    workspace_id: "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890a6",
    roles: ["owner"],
    permissions: ["knowledge:admin"],
    session_id: "deletion-request-session",
    auth_time: now,
    jti: randomBytes(12).toString("hex"),
    iss: "alter-platform-api.identity-broker",
    aud: "alter-engine",
    iat: now,
    exp: now + 60,
  };
}
