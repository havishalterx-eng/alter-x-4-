import { describe, expect, it, vi } from "vitest";
import { MarketplaceSearchService } from "./search.service";

describe("MarketplaceSearchService", () => {
  it("returns a signed next cursor when more than one page is available", async () => {
    const repository = { search: vi.fn().mockResolvedValue([{ kind: "listing", id: "lst_1", name: "Deploy", description: null, rank: 5, type: "agent" }, { kind: "tool", id: "tlm_1", name: "Deploy tool", description: null, rank: 4, ecosystem: "npm", trust_level: "community_reviewed" }]) };
    const result = await new MarketplaceSearchService(repository as never).search("tenant-a", { q: "deploy", limit: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.page).toMatchObject({ has_more: true, limit: 1 });
    expect(result.page.next_cursor).toEqual(expect.any(String));
  });
});
