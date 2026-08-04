import { describe, expect, it, vi } from "vitest";

import { CostRollupService, RollupValidationError, type RollupStore } from "./cost-rollup.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const WORKSPACE = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const WORKFLOW = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890a3";
const PSEUDONYM_KEY = "a".repeat(32);

function fakeStore(rows: readonly Record<string, unknown>[]) {
  const query = vi.fn().mockResolvedValue({ rowCount: rows.length, rows });
  const provisionerQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  const store: RollupStore = {
    withTenant: async (_tenantId, operation) => operation({ query }),
    withProvisioner: async (operation) => operation({ query: provisionerQuery }),
  };
  return {
    store,
    query,
    provisionerQuery,
  };
}

describe("CostRollupService", () => {
  it("rejects a marginRate outside [0, 1)", () => {
    const { store } = fakeStore([]);
    expect(() => new CostRollupService(store, 1, PSEUDONYM_KEY)).toThrow(RollupValidationError);
    expect(() => new CostRollupService(store, -0.1, PSEUDONYM_KEY)).toThrow(
      RollupValidationError,
    );
  });

  it("rejects a pseudonym key shorter than 32 characters", () => {
    const { store } = fakeStore([]);
    expect(() => new CostRollupService(store, 0.3, "short")).toThrow(RollupValidationError);
  });

  it("computes real billable/margin via the configured rate, ceil-rounded", async () => {
    const { store, query } = fakeStore([
      {
        mode: "workflow",
        internal_cost_minor: "1000",
        retry_cost_minor: "0",
        recovery_cost_minor: "0",
        event_count: "3",
      },
    ]);
    const service = new CostRollupService(store, 0.3, PSEUDONYM_KEY);

    const response = await service.queryRollups({
      tenant_id: TENANT,
      workspace_id: WORKSPACE,
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-01-02T00:00:00.000Z",
      dimensions: ["mode"],
      parent_id: "",
      currency: "INR",
    });

    const parsed = JSON.parse(response.rollups_json);
    // billable = ceil(1000 / (1 - 0.3)) = ceil(1428.57) = 1429
    expect(parsed.groups[0].billable_minor).toBe("1429");
    expect(parsed.groups[0].margin_minor).toBe("429");
    expect(parsed.totals.internal_cost_minor).toBe("1000");
    expect(parsed.currency).toBe("INR");
    expect(query).toHaveBeenCalled();
  });

  it("splits retry and recovery cost separately from normal cost", async () => {
    const { store } = fakeStore([
      {
        internal_cost_minor: "500",
        retry_cost_minor: "200",
        recovery_cost_minor: "100",
        event_count: "5",
      },
    ]);
    const service = new CostRollupService(store, 0.3, PSEUDONYM_KEY);

    const response = await service.queryRollups({
      tenant_id: TENANT,
      workspace_id: WORKSPACE,
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-01-02T00:00:00.000Z",
      dimensions: [],
      parent_id: "",
      currency: "INR",
    });

    const parsed = JSON.parse(response.rollups_json);
    expect(parsed.groups[0].retry_cost_minor).toBe("200");
    expect(parsed.groups[0].recovery_cost_minor).toBe("100");
  });

  it("rejects an unrecognized dimension rather than building unsafe SQL from it", async () => {
    const { store } = fakeStore([]);
    const service = new CostRollupService(store, 0.3, PSEUDONYM_KEY);

    await expect(
      service.queryRollups({
        tenant_id: TENANT,
        workspace_id: WORKSPACE,
        start_at: "2026-01-01T00:00:00.000Z",
        end_at: "2026-01-02T00:00:00.000Z",
        dimensions: ["'; DROP TABLE cost_events; --"],
        parent_id: "",
        currency: "INR",
      }),
    ).rejects.toThrow(RollupValidationError);
  });

  it("rejects end_at at or before start_at", async () => {
    const { store } = fakeStore([]);
    const service = new CostRollupService(store, 0.3, PSEUDONYM_KEY);

    await expect(
      service.queryRollups({
        tenant_id: TENANT,
        workspace_id: WORKSPACE,
        start_at: "2026-01-02T00:00:00.000Z",
        end_at: "2026-01-01T00:00:00.000Z",
        dimensions: [],
        parent_id: "",
        currency: "INR",
      }),
    ).rejects.toThrow(RollupValidationError);
  });

  it("upserts a real billing_rollups row via the provisioner role, keyed by a deterministic pseudonym", async () => {
    const { store, provisionerQuery } = fakeStore([
      { internal_cost_minor: "1000", retry_cost_minor: "0", recovery_cost_minor: "0", event_count: "1" },
    ]);
    const service = new CostRollupService(store, 0.3, PSEUDONYM_KEY);

    await service.queryRollups({
      tenant_id: TENANT,
      workspace_id: WORKSPACE,
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-01-02T00:00:00.000Z",
      dimensions: [],
      parent_id: "",
      currency: "INR",
    });

    expect(provisionerQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO billing_rollups"),
      expect.arrayContaining([service.pseudonym(TENANT.slice("ten_".length))]),
    );
  });

  it("filters a workflow rollup by parent_id and never mixes currencies", async () => {
    const { store, query } = fakeStore([]);
    const service = new CostRollupService(store, 0.3, PSEUDONYM_KEY);

    await service.queryRollups({
      tenant_id: TENANT,
      workspace_id: WORKSPACE,
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-01-02T00:00:00.000Z",
      dimensions: [],
      parent_id: WORKFLOW,
      currency: "INR",
    });

    const [statement, values] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain("AND parent_id = $5");
    expect(statement).toContain("AND currency = $6");
    expect(values).toEqual([
      TENANT.slice("ten_".length),
      WORKSPACE.slice("ws_".length),
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      WORKFLOW.slice("wf_".length),
      "INR",
    ]);
  });

  it("rejects unsupported parent IDs and currencies", async () => {
    const { store } = fakeStore([]);
    const service = new CostRollupService(store, 0.3, PSEUDONYM_KEY);
    const request = {
      tenant_id: TENANT,
      workspace_id: WORKSPACE,
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-01-02T00:00:00.000Z",
      dimensions: [],
    };

    await expect(
      service.queryRollups({ ...request, parent_id: "run_bad", currency: "INR" }),
    ).rejects.toThrow(RollupValidationError);
    await expect(
      service.queryRollups({ ...request, parent_id: "", currency: "EUR" }),
    ).rejects.toThrow(RollupValidationError);
  });

  it("produces the same pseudonym for the same tenant every time (real, deterministic, not random)", () => {
    const { store } = fakeStore([]);
    const service = new CostRollupService(store, 0.3, PSEUDONYM_KEY);
    const bareTenant = TENANT.slice("ten_".length);
    expect(service.pseudonym(bareTenant)).toBe(service.pseudonym(bareTenant));
    expect(service.pseudonym(bareTenant)).toMatch(/^tnp_[0-9a-f]{64}$/);
  });
});
