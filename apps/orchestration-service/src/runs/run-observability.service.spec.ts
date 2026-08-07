import { describe, expect, it, vi } from "vitest";

import {
  RunObservabilityService,
  type OrchestrationTenantStore,
} from "./run-observability.service";

const TENANT = "ten_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const RUN = "run_018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
const VERIFICATION = "ver_018f4d6e-cccc-7ccc-8ccc-cccccccccccc";

describe("RunObservabilityService", () => {
  it("reads persisted verification rows and derives quality gates from same rows", async () => {
    const query = vi.fn(async (statement: string) => {
      const sql = statement.replace(/\s+/g, " ").trim();
      if (sql.startsWith("SELECT id FROM runs")) return { rowCount: 1, rows: [{ id: RUN }] };
      if (sql.includes("FROM verification_results")) return {
        rowCount: 1,
        rows: [{ id: VERIFICATION, run_id: RUN, gate_type: "quality", verdict: "pass" }],
      };
      throw new Error(`Unexpected query ${sql}`);
    });
    const store: OrchestrationTenantStore = {
      async withTenant(tenantId, operation) {
        expect(tenantId).toBe(TENANT.slice("ten_".length));
        return operation({ query: query as never });
      },
    };
    const service = new RunObservabilityService(store);

    await expect(service.verificationResults(TENANT, RUN)).resolves.toMatchObject({
      data: [{ id: VERIFICATION, verdict: "pass" }],
      page: { has_more: false },
    });
    await expect(service.qualityGates(TENANT, RUN)).resolves.toMatchObject({
      data: [{ id: VERIFICATION, gate_type: "quality" }],
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("gate_type IN"))).toBe(true);
  });
});
