import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";
import type { CompiledDag } from "@alterx/contracts";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DurableRunQueue } from "./durable-run-queue.service";

const migrationsFolder = resolve(process.cwd(), "apps/orchestration-service/drizzle");
const TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const WORKSPACE = "018f4d6e-2b4a-7a3e-8c1a-1234567890a2";

const dag: CompiledDag = {
  schema_version: "v1",
  entry_node_keys: ["node_a"],
  nodes: [{ key: "node_a", type: "ToolCall", config: {}, metadata: { ui: {} } }],
  edges: [],
  waves: [{ key: "wave_0", order: 0, node_keys: ["node_a"], depends_on: [] }],
};

function runId(): string {
  const id = randomUUID();
  return `run_${id.slice(0, 14)}7${id.slice(15)}`;
}

describe.sequential("DurableRunQueue Postgres integration", () => {
  let postgres: StartedPostgreSqlContainer;
  let store: PostgresOrchestrationStoreProvider;
  let queue: DurableRunQueue;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:16.6-alpine")
      .withDatabase("orchestration_db")
      .withUsername("orchestration_admin")
      .withPassword(randomBytes(24).toString("hex"))
      .start();
    store = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: postgres.getConnectionUri(),
      migrationsFolder,
    });
    await store.migrate();
    queue = new DurableRunQueue(store);
  }, 90_000);

  afterAll(async () => {
    await store?.close();
    await postgres?.stop();
  }, 60_000);

  beforeEach(async () => {
    await store.withTenant(TENANT, async (tx) => {
      await tx.query("DELETE FROM run_dispatch_queue WHERE tenant_id = $1", [TENANT]);
      await tx.query("DELETE FROM runs WHERE tenant_id = $1", [TENANT]);
    });
  });

  async function seedRun(): Promise<string> {
    const id = runId();
    await store.withTenant(TENANT, async (tx) => {
      await tx.query(
        `INSERT INTO runs (id, tenant_id, workspace_id, parent_kind, status)
         VALUES ($1, $2, $3, 'workflow', 'pending')`,
        [id, TENANT, WORKSPACE],
      );
    });
    return id;
  }

  it("persists priority order and claims only one queued run", async () => {
    const [low, high, middle] = await Promise.all([seedRun(), seedRun(), seedRun()]);
    await queue.enqueue(TENANT, { runId: low, compiledDag: dag, priority: 1 });
    await queue.enqueue(TENANT, { runId: high, compiledDag: dag, priority: 10 });
    await queue.enqueue(TENANT, { runId: middle, compiledDag: dag, priority: 5 });

    const first = await queue.claimNext(TENANT);
    expect(first).toMatchObject({ runId: high, priority: 10, attempt: 1 });
    await queue.acknowledge(TENANT, first!.runId, first!.leaseToken);

    const second = await queue.claimNext(TENANT);
    expect(second).toMatchObject({ runId: middle, priority: 5, attempt: 1 });
  });

  it("reclaims a lease after expiry with an incremented attempt", async () => {
    const id = await seedRun();
    await queue.enqueue(TENANT, { runId: id, compiledDag: dag });

    const first = await queue.claimNext(TENANT, 1);
    expect(first).toMatchObject({ runId: id, attempt: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const retry = await queue.claimNext(TENANT, 1_000);
    expect(retry).toMatchObject({ runId: id, attempt: 2 });
    await queue.acknowledge(TENANT, retry!.runId, retry!.leaseToken);
  });
});
