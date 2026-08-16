import { describe, expect, it, vi } from "vitest";
import type { CompiledDag } from "@alterx/contracts";

import type { OrchestrationTenantStore } from "./run-launcher.service";
import { DurableRunQueue } from "./durable-run-queue.service";

const TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_A = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_B = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ac";

const dag: CompiledDag = {
  schema_version: "v1",
  entry_node_keys: ["node_a"],
  nodes: [{ key: "node_a", type: "ToolCall", config: {}, metadata: { ui: {} } }],
  edges: [],
  waves: [{ key: "wave_0", order: 0, node_keys: ["node_a"], depends_on: [] }],
};

function queueHarness(rows: readonly Record<string, unknown>[] = []) {
  const query = vi.fn(async (statement: string) => {
    if (statement.includes("WITH candidate")) {
      return { rowCount: rows.length, rows };
    }
    return { rowCount: 1, rows: [] };
  });
  const store: OrchestrationTenantStore = {
    withTenant: async (tenantId, operation) => {
      expect(tenantId).toBe(TENANT);
      return operation({ query } as never);
    },
  };
  return { queue: new DurableRunQueue(store), query };
}

describe("DurableRunQueue", () => {
  it("durably accepts a run with its immutable dispatch payload", async () => {
    const { queue, query } = queueHarness();

    await queue.enqueue(TENANT, { runId: RUN_A, compiledDag: dag, priority: 7 });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO run_dispatch_queue"),
      expect.arrayContaining([TENANT, RUN_A, 7, JSON.stringify(dag)]),
    );
  });

  it("claims one highest-priority available run with a Postgres lease", async () => {
    const { queue, query } = queueHarness([{
      run_id: RUN_B,
      priority: 10,
      compiled_dag: dag,
      already_running: false,
      lease_token: "lease-token",
      attempts: 1,
    }]);

    const claim = await queue.claimNext(TENANT, 5_000);

    expect(claim).toMatchObject({ runId: RUN_B, priority: 10, attempt: 1 });
    const statement = String(query.mock.calls[0]?.[0]);
    expect(statement).toContain("FOR UPDATE SKIP LOCKED");
    expect(statement).toContain("ORDER BY priority DESC");
    expect(statement).toContain("lease_expires_at");
  });

  it("makes expiry and explicit retry delay claimable without losing lease state", async () => {
    const { queue, query } = queueHarness();

    await expect(queue.retryLater(TENANT, RUN_A, "lease", 1_000)).resolves.toBe(true);
    await expect(queue.acknowledge(TENANT, RUN_A, "lease")).resolves.toBe(true);

    expect(String(query.mock.calls[0]?.[0])).toContain("available_at = clock_timestamp()");
    expect(String(query.mock.calls[0]?.[0])).toContain("lease_token = NULL");
    expect(String(query.mock.calls[1]?.[0])).toContain("DELETE FROM run_dispatch_queue");
  });
});
