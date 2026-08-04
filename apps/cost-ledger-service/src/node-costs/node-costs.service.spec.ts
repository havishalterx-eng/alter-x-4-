import { describe, expect, it, vi } from "vitest";

import type { CostStoreProvider } from "../database/cost-store.token";
import { NodeCostsService, NodeCostValidationError } from "./node-costs.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const WORKSPACE = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890a3";
const NODE = "018f4d6e-2b4a-7a3e-8c1a-1234567890a4";

describe("NodeCostsService", () => {
  it("groups real run costs by node without writing a billing rollup", async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ node_execution_id: NODE, internal_cost_minor: "37", event_count: "2" }],
    });
    const withTenant = vi.fn(async (_tenantId: string, operation: (tx: { query: typeof query }) => Promise<unknown>) => operation({ query }));
    const service = new NodeCostsService({ withTenant } as unknown as CostStoreProvider);

    await expect(
      service.getForRun({ tenantId: TENANT, workspaceId: WORKSPACE, runId: RUN }),
    ).resolves.toEqual([
      { nodeExecutionId: `node_${NODE}`, internalCostMinor: "37", eventCount: 2 },
    ]);
    expect(withTenant).toHaveBeenCalledWith(TENANT.slice(4), expect.any(Function));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("GROUP BY node_execution_id"),
      [TENANT.slice(4), WORKSPACE.slice(3), RUN.slice(4)],
    );
    expect(query.mock.calls[0]?.[0]).not.toContain("billing_rollups");
  });

  it("rejects an invalid run id before querying", async () => {
    const withTenant = vi.fn();
    const service = new NodeCostsService({ withTenant } as unknown as CostStoreProvider);

    await expect(
      service.getForRun({ tenantId: TENANT, workspaceId: WORKSPACE, runId: "run_invalid" }),
    ).rejects.toThrow(NodeCostValidationError);
    expect(withTenant).not.toHaveBeenCalled();
  });
});
