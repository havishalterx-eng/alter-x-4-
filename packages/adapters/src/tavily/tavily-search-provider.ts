import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ProviderHealth,
  ProviderMetadata,
  SearchProvider,
  SearchRequest,
  SearchResult,
  SearchResultItem,
} from "@alterx/shared-clients";

export interface TavilySearchProviderConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export interface TavilyHttpClient {
  postJson(url: string, body: unknown): Promise<unknown>;
}

export function createFetchTavilyHttpClient(): TavilyHttpClient {
  return {
    async postJson(url: string, body: unknown): Promise<unknown> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `Tavily request to ${url} failed with status ${response.status}`,
        );
      }
      return response.json();
    },
  };
}

const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";
const DEFAULT_MAX_RESULTS = 5;

export const TAVILY_SEARCH_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 10_000,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const TAVILY_SEARCH_METADATA: ProviderMetadata<"SearchProvider"> = {
  providerId: "tavily-search",
  interfaceName: "SearchProvider",
  displayName: "Tavily Search",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.tavily.search",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "tavily-search-v1",
    rollbackSupported: true,
  },
};

interface TavilySearchResultRaw {
  readonly title?: unknown;
  readonly url?: unknown;
  readonly content?: unknown;
  readonly score?: unknown;
}

interface TavilySearchResponse {
  readonly results?: unknown;
}

function validateRequest(request: SearchRequest): void {
  if (request.tenantId.trim().length === 0) {
    throw new Error("Search tenantId is required");
  }
  if (request.query.trim().length === 0) {
    throw new Error("Search query is required");
  }
}

function parseSearchResponse(raw: unknown): readonly SearchResultItem[] {
  const response = raw as TavilySearchResponse;
  if (!Array.isArray(response.results)) {
    throw new Error("Tavily search response must contain a results array");
  }
  const items: SearchResultItem[] = [];
  for (const entry of response.results as TavilySearchResultRaw[]) {
    if (
      typeof entry.title !== "string" ||
      typeof entry.url !== "string" ||
      typeof entry.content !== "string" ||
      typeof entry.score !== "number"
    ) {
      throw new Error(
        "Tavily search result entry is missing title, url, content, or score",
      );
    }
    items.push({
      title: entry.title,
      url: entry.url,
      snippet: entry.content,
      score: entry.score,
    });
  }
  return Object.freeze(items);
}

export class TavilySearchProvider implements SearchProvider {
  readonly metadata = TAVILY_SEARCH_METADATA;
  readonly capabilities = TAVILY_SEARCH_CAPABILITIES;

  readonly #config: Required<TavilySearchProviderConfig>;
  readonly #client: TavilyHttpClient;
  readonly #now: () => Date;

  constructor(
    config: TavilySearchProviderConfig,
    client?: TavilyHttpClient,
    now?: () => Date,
  ) {
    if (config.apiKey.trim().length === 0) {
      throw new Error("Tavily API key is required");
    }
    this.#config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_TAVILY_BASE_URL,
    };
    this.#client = client ?? createFetchTavilyHttpClient();
    this.#now = now ?? (() => new Date());
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    validateRequest(request);
    const raw = await this.#client.postJson(`${this.#config.baseUrl}/search`, {
      api_key: this.#config.apiKey,
      query: request.query,
      max_results: request.maxResults ?? DEFAULT_MAX_RESULTS,
    });
    return { results: parseSearchResponse(raw) };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: {
        configured: true,
        liveProbe: false,
      },
    };
  }
}
