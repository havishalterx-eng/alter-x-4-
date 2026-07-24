import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import { cosineSimilarity } from "../semantic-cache";
import type {
  CacheProvider,
  ProviderHealth,
  ProviderMetadata,
  SemanticCacheLookupRequest,
  SemanticCacheLookupResult,
  SemanticCacheStoreRequest,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_CACHE_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(50_000),
  batch_support: false,
};

const DEFAULT_SIMILARITY_THRESHOLD = 0.95;

interface StoredEntry {
  readonly embedding: readonly number[];
  readonly valueJson: string;
  readonly expiresAtMs?: number;
}

export interface MockCacheProvider extends CacheProvider {
  getStoredEntries(): readonly SemanticCacheStoreRequest[];
}

export interface MockCacheProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"CacheProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly now?: () => Date;
}

export function createMockCacheProvider(
  options: MockCacheProviderOptions = {},
): MockCacheProvider {
  const providerId = options.providerId ?? "mock.cache";
  const now = options.now ?? (() => new Date());
  const stores: SemanticCacheStoreRequest[] = [];
  const entriesByTenant = new Map<string, StoredEntry[]>();

  function lookup(
    request: SemanticCacheLookupRequest,
  ): SemanticCacheLookupResult {
    const nowMs = now().getTime();
    const threshold = request.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const entries = (entriesByTenant.get(request.tenantId) ?? []).filter(
      (entry) => entry.expiresAtMs === undefined || entry.expiresAtMs > nowMs,
    );
    let best: { readonly entry: StoredEntry; readonly similarity: number } | undefined;
    for (const entry of entries) {
      const similarity = cosineSimilarity(request.embedding, entry.embedding);
      if (best === undefined || similarity > best.similarity) {
        best = { entry, similarity };
      }
    }
    if (best === undefined || best.similarity < threshold) {
      return { hit: false };
    }
    return {
      hit: true,
      valueJson: best.entry.valueJson,
      similarity: best.similarity,
    };
  }

  function store(request: SemanticCacheStoreRequest): void {
    stores.push({ ...request });
    const existing = entriesByTenant.get(request.tenantId) ?? [];
    const expiresAtMs =
      request.ttlSeconds === undefined
        ? undefined
        : now().getTime() + request.ttlSeconds * 1000;
    entriesByTenant.set(request.tenantId, [
      ...existing,
      { embedding: request.embedding, valueJson: request.valueJson, ...(expiresAtMs === undefined ? {} : { expiresAtMs }) },
    ]);
  }

  return createMockProvider<MockCacheProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "CacheProvider"),
    capabilities: options.capabilities ?? MOCK_CACHE_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      lookupSemantic: async (request) => lookup(request),
      storeSemantic: async (request) => store(request),
      getStoredEntries: () => stores.map((entry) => ({ ...entry })),
    },
  });
}
