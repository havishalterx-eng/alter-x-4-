import { describe, expect, it, vi } from "vitest";
import { MarketplaceSearchRepository } from "./search.repository";

function createRepository(rows: unknown[] = []) {
  const client = { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn() };
  return { repository: new MarketplaceSearchRepository(pool as never), client };
}

describe("MarketplaceSearchRepository", () => {
  it("uses parameterized FTS and trigram ranking while excluding unpublished and blocked records", async () => {
    const { repository, client } = createRepository([{ kind: "listing", id: "lst_exact", name: "Deploy agent", description: null, rank: 10, type: "agent", ecosystem: null, trust_level: null }, { kind: "tool", id: "tlm_typo", name: "Depliy", description: null, rank: 0.2, type: null, ecosystem: "npm", trust_level: "community_reviewed" }]);
    const results = await repository.search("tenant-a", { q: "deploy", limit: 50 });
    const [sql, values] = client.query.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain("ts_rank(l.search_document, q.value) * 10 + similarity(l.name, $1)");
    expect(sql).toContain("l.status = 'published'");
    expect(sql).toContain("t.status = 'published' AND t.trust_level <> 'blocked'");
    expect(sql).toContain("l.search_document @@ q.value OR l.name % $1");
    expect(sql).not.toContain("'deploy'");
    expect(values[0]).toBe("deploy");
    expect(results.map((item) => item.id)).toEqual(["lst_exact", "tlm_typo"]);
    expect(results[0]!.rank).toBeGreaterThan(results[1]!.rank);
  });
  it("sets the tenant RLS context while published catalog visibility stays global", async () => {
    const { repository, client } = createRepository();
    await repository.search("tenant-b", { q: "deploy", limit: 1 });
    expect(client.query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.current_tenant_id', $1, true)", ["tenant-b"]);
    expect(String(client.query.mock.calls[2]![0])).not.toContain("tenant_id =");
  });
});
