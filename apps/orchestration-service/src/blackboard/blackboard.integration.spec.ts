import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  RedisContainer,
  type StartedRedisContainer,
} from "@testcontainers/redis";
import {
  PostgresOrchestrationStoreProvider,
  RedisCacheProvider,
} from "@alterx/adapters";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BlackboardCheckpointNotFoundError,
  BlackboardRunNotFoundError,
  BlackboardService,
  type OrchestrationTenantStore,
} from "./blackboard.service";

const migrationsFolder = resolve(
  process.cwd(),
  "apps/orchestration-service/drizzle",
);
const TENANT_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const TENANT_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b1";
const TENANT_A_REQUEST = `ten_${TENANT_A}`;
const TENANT_B_REQUEST = `ten_${TENANT_B}`;
const WORKSPACE_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const WORKSPACE_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b2";
const RUN_A = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890a3";
const RUN_A_CHILD = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890a4";
const RUN_B = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890a5";

interface StoredCheckpoint extends Record<string, unknown> {
  readonly value_json: unknown;
  readonly revision: number;
}

describe.sequential("BlackboardService real Redis and Postgres integration", () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let redisStopped = false;
  let store: PostgresOrchestrationStoreProvider;
  let cache: RedisCacheProvider;
  let service: BlackboardService;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer("postgres:16.6-alpine")
        .withDatabase("orchestration_db")
        .withUsername("blackboard_test")
        .withPassword(randomBytes(24).toString("hex"))
        .start(),
      new RedisContainer("redis:7.4.2-alpine").start(),
    ]);
    store = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: postgres.getConnectionUri(),
      migrationsFolder,
    });
    await store.migrate();
    cache = new RedisCacheProvider({
      host: redis.getHost(),
      port: redis.getPort(),
    });
    service = new BlackboardService(store, cache, {
      hotContextTtlSeconds: 300,
    });
  }, 90_000);

  afterAll(async () => {
    await cache?.close().catch(() => undefined);
    await store?.close();
    if (!redisStopped) {
      await redis?.stop();
    }
    await postgres?.stop();
  }, 60_000);

  beforeEach(async () => {
    await redis.executeCliCmd("FLUSHALL");
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await store.withTenant(tenantId, async (tx) => {
        await tx.query(
          "DELETE FROM blackboard_checkpoints WHERE tenant_id = $1",
          [tenantId],
        );
        await tx.query("DELETE FROM runs WHERE tenant_id = $1", [tenantId]);
      });
    }
  });

  async function seedRun(
    tenantId: string,
    workspaceId: string,
    runId: string,
  ): Promise<void> {
    await store.withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO runs
           (id, tenant_id, workspace_id, parent_kind, status)
         VALUES ($1, $2, $3, 'workflow', 'running')`,
        [runId, tenantId, workspaceId],
      );
    });
  }

  async function storedCheckpoint(
    tenantId: string,
    runId: string,
    key: string,
  ): Promise<StoredCheckpoint | undefined> {
    return store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<StoredCheckpoint>(
        `SELECT value_json, revision
         FROM blackboard_checkpoints
         WHERE tenant_id = $1 AND run_id = $2 AND context_key = $3`,
        [tenantId, runId, key],
      );
      return result.rows[0];
    });
  }

  it("writes durable-first and uses only canonical bb:{run_id}:{key} Redis keys", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);

    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "execution.state",
      value: { step: 1 },
    });

    expect(await storedCheckpoint(TENANT_A, RUN_A, "execution.state")).toEqual({
      value_json: { step: 1 },
      revision: 1,
    });
    const expectedKey = `bb:${RUN_A}:execution.state`;
    expect((await redis.executeCliCmd("KEYS", ["*"])).trim()).toBe(expectedKey);
    expect(Number(await redis.executeCliCmd("TTL", [expectedKey]))).toBeGreaterThan(0);

    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "execution.state",
      value: { step: 2 },
    });
    expect(await service.readValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "execution.state",
    })).toEqual({ step: 2 });
    expect(await storedCheckpoint(TENANT_A, RUN_A, "execution.state")).toEqual({
      value_json: { step: 2 },
      revision: 2,
    });
  });

  it("recovers from a Redis flush and rehydrates hot context from Postgres", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);
    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "checkpoint",
      value: { node: "collect", complete: true },
    });
    await redis.executeCliCmd("FLUSHALL");

    await expect(
      service.readValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A,
        key: "checkpoint",
      }),
    ).resolves.toEqual({ node: "collect", complete: true });
    expect(await cache.getValue(`bb:${RUN_A}:checkpoint`)).toContain(
      '"complete":true',
    );
  });

  it("checks durable revision so stale Redis data can never override Postgres", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);
    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "checkpoint",
      value: { version: "old" },
    });
    await store.withTenant(TENANT_A, async (tx) => {
      await tx.query(
        `UPDATE blackboard_checkpoints
         SET value_json = '{"version":"durable"}'::jsonb,
             revision = revision + 1,
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND run_id = $2 AND context_key = $3`,
        [TENANT_A, RUN_A, "checkpoint"],
      );
    });

    await expect(
      service.readValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A,
        key: "checkpoint",
      }),
    ).resolves.toEqual({ version: "durable" });
    expect(await cache.getValue(`bb:${RUN_A}:checkpoint`)).toContain(
      '"revision":2',
    );
  });

  it("inherits only an explicit scoped slice into a child run", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A_CHILD);
    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "intent",
      value: { action: "ship-order" },
    });
    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "private.parent-only",
      value: true,
    });

    await expect(
      service.inheritContext({
        tenantId: TENANT_A_REQUEST,
        parentRunId: RUN_A,
        childRunId: RUN_A_CHILD,
        keys: ["intent"],
      }),
    ).resolves.toEqual({ inheritedKeys: ["intent"] });
    await expect(
      service.readValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A_CHILD,
        key: "intent",
      }),
    ).resolves.toEqual({ action: "ship-order" });
    await expect(
      service.readValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A_CHILD,
        key: "private.parent-only",
      }),
    ).resolves.toBeUndefined();
  });

  it("rolls back inheritance when any requested checkpoint is missing", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A_CHILD);
    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "present",
      value: "available",
    });

    await expect(
      service.inheritContext({
        tenantId: TENANT_A_REQUEST,
        parentRunId: RUN_A,
        childRunId: RUN_A_CHILD,
        keys: ["present", "missing"],
      }),
    ).rejects.toThrow(BlackboardCheckpointNotFoundError);
    await expect(
      service.readValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A_CHILD,
        key: "present",
      }),
    ).resolves.toBeUndefined();
  });

  it("isolates tenants even with adjacent globally unique run IDs", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);
    await seedRun(TENANT_B, WORKSPACE_B, RUN_B);
    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "shared-name",
      value: "tenant-a",
    });
    await service.writeValue({
      tenantId: TENANT_B_REQUEST,
      runId: RUN_B,
      key: "shared-name",
      value: "tenant-b",
    });

    await expect(
      service.readValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_B,
        key: "shared-name",
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.readValue({
        tenantId: TENANT_B_REQUEST,
        runId: RUN_A,
        key: "shared-name",
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.readValue({
        tenantId: TENANT_B_REQUEST,
        runId: RUN_B,
        key: "shared-name",
      }),
    ).resolves.toBe("tenant-b");
  });

  it("passes bare UUID tenant context to every withTenant call", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);
    const seenTenantIds: string[] = [];
    const recordingStore: OrchestrationTenantStore = {
      withTenant: async (tenantId, operation) => {
        seenTenantIds.push(tenantId);
        return store.withTenant(tenantId, operation);
      },
    };
    const recordingService = new BlackboardService(recordingStore, cache);

    await recordingService.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "boundary",
      value: "bare-uuid",
    });
    await recordingService.readValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "boundary",
    });

    expect(seenTenantIds).not.toHaveLength(0);
    expect(new Set(seenTenantIds)).toEqual(new Set([TENANT_A]));
  });

  it("fails closed before caching when durable checkpoint cannot be written", async () => {
    await expect(
      service.writeValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A,
        key: "missing-run",
        value: "must-not-cache",
      }),
    ).rejects.toThrow(BlackboardRunNotFoundError);
    await expect(cache.getValue(`bb:${RUN_A}:missing-run`)).resolves.toBeUndefined();
  });

  it("rejects non-JSON numeric values before touching durable or hot storage", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);

    await expect(
      service.writeValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A,
        key: "invalid",
        value: Number.NaN,
      }),
    ).rejects.toThrow("value numbers must be finite");
    await expect(storedCheckpoint(TENANT_A, RUN_A, "invalid")).resolves.toBeUndefined();
    await expect(cache.getValue(`bb:${RUN_A}:invalid`)).resolves.toBeUndefined();
  });

  it("continues from Postgres when Redis is killed mid-run", async () => {
    await seedRun(TENANT_A, WORKSPACE_A, RUN_A);
    await service.writeValue({
      tenantId: TENANT_A_REQUEST,
      runId: RUN_A,
      key: "chaos",
      value: { progress: 40 },
    });
    await redis.stop();
    redisStopped = true;

    await expect(
      service.readValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A,
        key: "chaos",
      }),
    ).resolves.toEqual({ progress: 40 });
    await expect(
      service.writeValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A,
        key: "chaos",
        value: { progress: 80 },
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.readValue({
        tenantId: TENANT_A_REQUEST,
        runId: RUN_A,
        key: "chaos",
      }),
    ).resolves.toEqual({ progress: 80 });
  }, 20_000);
});
