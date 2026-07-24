import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ProviderHealth,
  ProviderMetadata,
  SearchProvider,
  SearchRequest,
  SearchResult,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_SEARCH_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(50_000),
  batch_support: false,
};

export interface MockSearchProvider extends SearchProvider {
  getRequests(): readonly SearchRequest[];
}

export interface MockSearchProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"SearchProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly search?: (request: SearchRequest) => Promise<SearchResult>;
}

function defaultSearch(request: SearchRequest): SearchResult {
  return {
    results: [
      {
        title: `Mock result for ${request.query}`,
        url: "https://example.com/mock-result",
        snippet: `Deterministic mock snippet for query: ${request.query}`,
        score: 1,
      },
    ],
  };
}

export function createMockSearchProvider(
  options: MockSearchProviderOptions = {},
): MockSearchProvider {
  const providerId = options.providerId ?? "mock.search";
  const requests: SearchRequest[] = [];
  const search = options.search ?? (async (request) => defaultSearch(request));

  return createMockProvider<MockSearchProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "SearchProvider"),
    capabilities: options.capabilities ?? MOCK_SEARCH_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      search: async (request) => {
        requests.push({ ...request });
        return search(request);
      },
      getRequests: () => requests.map((request) => ({ ...request })),
    },
  });
}
