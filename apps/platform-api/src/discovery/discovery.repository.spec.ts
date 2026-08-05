import { describe, expect, it, vi } from "vitest";
import { DiscoveryRepository } from "./discovery.repository";
import type { DiscoveryCandidate } from "./types";

const tenantId = "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const workspaceId = "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaab";
const recommendationId = "rec_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac";
const candidate: DiscoveryCandidate = {
  problemStatement: "Reduce recurring human approval work in connected workflows",
  evidence: { run_ids: ["run_1"] },
  estimatedValue: 61,
  estimatedEffort: 2,
  requiredIntegrations: ["github"],
  riskLevel: "medium",
  confidence: 0.66,
};

const row = {
  id: recommendationId,
  tenant_id: tenantId,
  workspace_id: workspaceId,
  problem_statement: candidate.problemStatement,
  evidence_json: candidate.evidence,
  estimated_value: candidate.estimatedValue,
  estimated_effort: candidate.estimatedEffort,
  required_integrations_json: candidate.requiredIntegrations,
  risk_level: candidate.riskLevel,
  confidence: "0.66",
  status: "suggested" as const,
  created_at: new Date("2026-08-05T00:00:00.000Z"),
};

function fakeRepository(selectRows: readonly typeof row[] = [row]) {
  const query = vi.fn().mockImplementation((statement: string) => {
    if (statement.includes("SELECT id, tenant_id")) return Promise.resolve({ rowCount: selectRows.length, rows: selectRows });
    if (statement.includes("UPDATE discovery_recommendations")) return Promise.resolve({ rowCount: 1, rows: [] });
    return Promise.resolve({ rowCount: 1, rows: [] });
  });
  const release = vi.fn();
  const end = vi.fn().mockResolvedValue(undefined);
  const pool = { connect: vi.fn().mockResolvedValue({ query, release }), end };
  return { repository: new DiscoveryRepository(pool as never, true), query, release, end };
}

describe("DiscoveryRepository", () => {
  it("upserts suggested recommendations inside tenant RLS context", async () => {
    const { repository, query, release } = fakeRepository();

    await repository.upsertSuggested(tenantId, workspaceId, recommendationId, candidate);

    expect(query).toHaveBeenCalledWith("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("ON CONFLICT (tenant_id, workspace_id, problem_statement)"))).toBe(true);
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("lists and finds only rows scoped by tenant and workspace", async () => {
    const { repository, query } = fakeRepository();

    await expect(repository.list(tenantId, workspaceId)).resolves.toMatchObject([{ id: recommendationId, confidence: 0.66 }]);
    await expect(repository.find(tenantId, workspaceId, recommendationId)).resolves.toMatchObject({ id: recommendationId });
    const selects = query.mock.calls.filter(([sql]) => String(sql).includes("FROM discovery_recommendations"));
    expect(selects.every(([, values]) => values?.[0] === tenantId && values?.[1] === workspaceId)).toBe(true);
  });

  it("returns undefined for a recommendation outside caller scope", async () => {
    const { repository } = fakeRepository([]);
    await expect(repository.find(tenantId, workspaceId, recommendationId)).resolves.toBeUndefined();
  });

  it("records accepted workflow evidence and supports dismissal", async () => {
    const { repository, query, end } = fakeRepository();

    await expect(repository.accept(tenantId, workspaceId, recommendationId, "wf_1")).resolves.toBe(true);
    await expect(repository.dismiss(tenantId, workspaceId, recommendationId)).resolves.toBe(true);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("UPDATE discovery_recommendations"))).toHaveLength(2);
    await repository.onModuleDestroy();
    expect(end).toHaveBeenCalledOnce();
  });

  it("rolls back and releases connection when a query fails", async () => {
    const { repository, query, release } = fakeRepository();
    query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(repository.list(tenantId, workspaceId)).rejects.toThrow("database unavailable");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
