import Redis from "ioredis";

import type { ProviderCapabilities } from "@alterx/contracts";
import {
  cosineSimilarity,
  type CacheProvider,
  type ProviderHealth,
  type ProviderMetadata,
  type SemanticCacheLookupRequest,
  type SemanticCacheLookupResult,
  type SemanticCacheStoreRequest,
} from "@alterx/shared-clients";

export interface RedisCacheProviderConfig {
  readonly host: string;
  readonly port: number;
  readonly tlsEnabled?: boolean;
  readonly maxCandidatesPerTenant?: number;
  readonly defaultSimilarityThreshold?: number;
  readonly defaultTtlSeconds?: number;
}

export interface RedisCommandClient {
  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<"OK">;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<string>;
}

interface StoredCandidate {
  readonly embedding: readonly number[];
  readonly valueJson: string;
}

const DEFAULT_MAX_CANDIDATES_PER_TENANT = 50;
const DEFAULT_SIMILARITY_THRESHOLD = 0.95;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export const REDIS_CACHE_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 262_144,
  supported_languages: [],
  cost_model: { rates: [] },
};

const REDIS_CACHE_METADATA: ProviderMetadata<"CacheProvider"> = {
  providerId: "redis-semantic-cache",
  interfaceName: "CacheProvider",
  displayName: "Redis Semantic Cache",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.redis.semantic_cache",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "redis-semantic-cache-v1",
    rollbackSupported: true,
  },
};

function candidateKey(tenantId: string): string {
  return `cache:semantic:${tenantId}:candidates`;
}

function parseCandidate(raw: string): StoredCandidate | undefined {
  try {
    const parsed = JSON.parse(raw) as {
      readonly embedding?: unknown;
      readonly valueJson?: unknown;
    };
    if (
      !Array.isArray(parsed.embedding) ||
      !parsed.embedding.every((value) => typeof value === "number") ||
      typeof parsed.valueJson !== "string"
    ) {
      return undefined;
    }
    return { embedding: parsed.embedding, valueJson: parsed.valueJson };
  } catch {
    return undefined;
  }
}

export class RedisCacheProvider implements CacheProvider {
  readonly metadata = REDIS_CACHE_METADATA;
  readonly capabilities = REDIS_CACHE_CAPABILITIES;

  readonly #client: RedisCommandClient;
  readonly #maxCandidatesPerTenant: number;
  readonly #defaultSimilarityThreshold: number;
  readonly #defaultTtlSeconds: number;
  readonly #now: () => Date;

  constructor(
    config: RedisCacheProviderConfig,
    client?: RedisCommandClient,
    now?: () => Date,
  ) {
    if (config.host.trim().length === 0) {
      throw new Error("Redis host is required");
    }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
      throw new Error("Redis port must be an integer from 1 to 65535");
    }
    this.#maxCandidatesPerTenant =
      config.maxCandidatesPerTenant ?? DEFAULT_MAX_CANDIDATES_PER_TENANT;
    this.#defaultSimilarityThreshold =
      config.defaultSimilarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    this.#defaultTtlSeconds = config.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.#client =
      client ??
      (new Redis({
        host: config.host,
        port: config.port,
        tls: config.tlsEnabled === true ? {} : undefined,
        lazyConnect: true,
      }) as unknown as RedisCommandClient);
    this.#now = now ?? (() => new Date());
  }

  async lookupSemantic(
    request: SemanticCacheLookupRequest,
  ): Promise<SemanticCacheLookupResult> {
    if (request.tenantId.trim().length === 0) {
      throw new Error("Semantic cache lookup tenantId is required");
    }
    if (request.embedding.length === 0) {
      throw new Error("Semantic cache lookup embedding must not be empty");
    }
    const threshold =
      request.similarityThreshold ?? this.#defaultSimilarityThreshold;
    const raw = await this.#client.lrange(
      candidateKey(request.tenantId),
      0,
      this.#maxCandidatesPerTenant - 1,
    );

    let best: { readonly candidate: StoredCandidate; readonly similarity: number } | undefined;
    for (const entry of raw) {
      const candidate = parseCandidate(entry);
      if (candidate === undefined) {
        continue;
      }
      const similarity = cosineSimilarity(request.embedding, candidate.embedding);
      if (best === undefined || similarity > best.similarity) {
        best = { candidate, similarity };
      }
    }

    if (best === undefined || best.similarity < threshold) {
      return { hit: false };
    }
    return {
      hit: true,
      valueJson: best.candidate.valueJson,
      similarity: best.similarity,
    };
  }

  async storeSemantic(request: SemanticCacheStoreRequest): Promise<void> {
    if (request.tenantId.trim().length === 0) {
      throw new Error("Semantic cache store tenantId is required");
    }
    if (request.embedding.length === 0) {
      throw new Error("Semantic cache store embedding must not be empty");
    }
    const key = candidateKey(request.tenantId);
    const payload: StoredCandidate = {
      embedding: request.embedding,
      valueJson: request.valueJson,
    };
    await this.#client.lpush(key, JSON.stringify(payload));
    await this.#client.ltrim(key, 0, this.#maxCandidatesPerTenant - 1);
    await this.#client.expire(
      key,
      request.ttlSeconds ?? this.#defaultTtlSeconds,
    );
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = this.#now().toISOString();
    try {
      const pong = await this.#client.ping();
      return {
        status: pong === "PONG" ? "healthy" : "degraded",
        checkedAt,
        latencyMs: 0,
        details: { liveProbe: true },
      };
    } catch {
      return {
        status: "unhealthy",
        checkedAt,
        latencyMs: 0,
        details: { liveProbe: true },
      };
    }
  }

  async close(): Promise<void> {
    await this.#client.quit();
  }
}
