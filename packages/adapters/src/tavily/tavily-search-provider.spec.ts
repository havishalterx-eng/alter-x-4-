import {
  assertProviderContractParity,
  createMockSearchProvider,
  searchProviderContract,
  type SearchProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  TAVILY_SEARCH_CAPABILITIES,
  TavilySearchProvider,
  type TavilyHttpClient,
} from "./tavily-search-provider";

function fakeClient(
  handler: (url: string, body: unknown) => Promise<unknown>,
): TavilyHttpClient {
  return { postJson: vi.fn(handler) };
}

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";

function realProvider(): SearchProvider {
  const client = fakeClient(async (_url, body) => {
    const parsed = body as { readonly query: string };
    return {
      results: [
        {
          title: `Result for ${parsed.query}`,
          url: "https://example.com/result",
          content: "a real snippet",
          score: 0.9,
        },
      ],
    };
  });
  return new TavilySearchProvider({ apiKey: "test-api-key" }, client, () => new Date(FIXED_CHECKED_AT));
}

function equivalentMockProvider(): SearchProvider {
  return createMockSearchProvider({
    capabilities: TAVILY_SEARCH_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true, liveProbe: false },
    },
    search: async (request) => ({
      results: [
        {
          title: `Result for ${request.query}`,
          url: "https://example.com/result",
          snippet: "a real snippet",
          score: 0.9,
        },
      ],
    }),
  });
}

describe("TavilySearchProvider", () => {
  it("satisfies the search provider contract with parity against the mock", async () => {
    const report = await assertProviderContractParity(searchProviderContract, [
      { name: "tavily-real", create: realProvider },
      { name: "tavily-mock", create: equivalentMockProvider },
    ]);

    expect(report.passed).toBe(true);
  });

  it("publishes Tavily capabilities", () => {
    const provider = realProvider();
    expect(provider.capabilities).toEqual(TAVILY_SEARCH_CAPABILITIES);
  });

  it("sends the query and api key to Tavily and parses results", async () => {
    let capturedUrl = "";
    let capturedBody: unknown;
    const client = fakeClient(async (url, body) => {
      capturedUrl = url;
      capturedBody = body;
      return {
        results: [
          { title: "t", url: "https://example.com", content: "c", score: 0.5 },
        ],
      };
    });
    const provider = new TavilySearchProvider(
      { apiKey: "secret-key" },
      client,
    );

    const result = await provider.search({
      tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      query: "hello world",
      maxResults: 3,
    });

    expect(capturedUrl).toBe("https://api.tavily.com/search");
    expect(capturedBody).toEqual({
      api_key: "secret-key",
      query: "hello world",
      max_results: 3,
    });
    expect(result.results).toEqual([
      { title: "t", url: "https://example.com", snippet: "c", score: 0.5 },
    ]);
  });

  it("rejects an empty tenantId", async () => {
    const provider = realProvider();
    await expect(
      provider.search({ tenantId: "", query: "x" }),
    ).rejects.toThrow("tenantId is required");
  });

  it("rejects an empty query", async () => {
    const provider = realProvider();
    await expect(
      provider.search({ tenantId: "ten_a", query: "" }),
    ).rejects.toThrow("query is required");
  });

  it("rejects a malformed Tavily response", async () => {
    const client = fakeClient(async () => ({ results: "not-an-array" }));
    const provider = new TavilySearchProvider({ apiKey: "k" }, client);
    await expect(
      provider.search({ tenantId: "ten_a", query: "x" }),
    ).rejects.toThrow("must contain a results array");
  });

  it("requires a non-empty API key at construction", () => {
    expect(() => new TavilySearchProvider({ apiKey: "" })).toThrow(
      "Tavily API key is required",
    );
  });

  it("reports a config-only health check", async () => {
    const provider = realProvider();
    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");
    expect(health.details).toMatchObject({ liveProbe: false });
  });
});
