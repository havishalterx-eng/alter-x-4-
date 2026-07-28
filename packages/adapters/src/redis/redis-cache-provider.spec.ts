import {
  assertProviderContractParity,
  cacheProviderContract,
  createMockCacheProvider,
  type CacheProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  REDIS_CACHE_CAPABILITIES,
  RedisCacheProvider,
  type RedisCommandClient,
} from "./redis-cache-provider";

const FIXED_CHECKED_AT = "2026-07-25T00:00:00.000Z";

function fakeRedisClient(): RedisCommandClient & {
  readonly store: Map<string, string[]>;
  readonly expireCalls: { key: string; seconds: number }[];
} {
  const store = new Map<string, string[]>();
  const expireCalls: { key: string; seconds: number }[] = [];
  return {
    store,
    expireCalls,
    get: vi.fn(async (key: string) => store.get(key)?.[0] ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, [value]);
      return "OK" as const;
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    lpush: vi.fn(async (key: string, value: string) => {
      const list = store.get(key) ?? [];
      list.unshift(value);
      store.set(key, list);
      return list.length;
    }),
    ltrim: vi.fn(async (key: string, start: number, stop: number) => {
      const list = store.get(key) ?? [];
      store.set(key, list.slice(start, stop + 1));
      return "OK" as const;
    }),
    lrange: vi.fn(async (key: string, start: number, stop: number) => {
      const list = store.get(key) ?? [];
      return list.slice(start, stop + 1);
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      expireCalls.push({ key, seconds });
      return 1;
    }),
    ping: vi.fn(async () => "PONG"),
    quit: vi.fn(async () => "OK"),
  };
}

function realProvider(client = fakeRedisClient()): CacheProvider {
  return new RedisCacheProvider(
    { host: "localhost", port: 6379 },
    client,
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): CacheProvider {
  return createMockCacheProvider({
    capabilities: REDIS_CACHE_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { liveProbe: true },
    },
    now: () => new Date(FIXED_CHECKED_AT),
  });
}

describe("RedisCacheProvider", () => {
  it("satisfies the cache provider contract with parity against the mock", async () => {
    const report = await assertProviderContractParity(cacheProviderContract, [
      { name: "redis-real", create: () => realProvider() },
      { name: "redis-mock", create: equivalentMockProvider },
    ]);

    expect(report.passed).toBe(true);
  });

  it("publishes Redis cache capabilities", () => {
    expect(realProvider().capabilities).toEqual(REDIS_CACHE_CAPABILITIES);
  });

  it("reads, writes, and deletes exact-key values with a Redis TTL", async () => {
    const client = fakeRedisClient();
    const provider = new RedisCacheProvider(
      { host: "localhost", port: 6379 },
      client,
    );

    expect(await provider.getValue("bb:run_1:state")).toBeUndefined();
    await provider.setValue("bb:run_1:state", '{"step":1}', 90);
    expect(client.set).toHaveBeenCalledWith(
      "bb:run_1:state",
      '{"step":1}',
      "EX",
      90,
    );
    expect(await provider.getValue("bb:run_1:state")).toBe('{"step":1}');
    await provider.deleteValue("bb:run_1:state");
    expect(await provider.getValue("bb:run_1:state")).toBeUndefined();
  });

  it("validates exact-key operations", async () => {
    const provider = new RedisCacheProvider(
      { host: "localhost", port: 6379 },
      fakeRedisClient(),
    );

    await expect(provider.getValue(" ")).rejects.toThrow("Cache key is required");
    await expect(provider.deleteValue("")).rejects.toThrow("Cache key is required");
    await expect(provider.setValue("key", "value", 0)).rejects.toThrow(
      "Cache TTL must be a positive integer",
    );
  });

  it("stores a candidate, trims to the configured cap, and sets a TTL", async () => {
    const client = fakeRedisClient();
    const provider = new RedisCacheProvider(
      { host: "localhost", port: 6379, maxCandidatesPerTenant: 2 },
      client,
    );

    await provider.storeSemantic({
      tenantId: "ten_a",
      embedding: [1, 0],
      valueJson: "one",
    });
    await provider.storeSemantic({
      tenantId: "ten_a",
      embedding: [0, 1],
      valueJson: "two",
    });
    await provider.storeSemantic({
      tenantId: "ten_a",
      embedding: [1, 1],
      valueJson: "three",
    });

    expect(client.store.get("cache:semantic:ten_a:candidates")).toHaveLength(2);
    expect(client.expireCalls).toHaveLength(3);
    expect(client.expireCalls[0]?.seconds).toBe(24 * 60 * 60);
  });

  it("returns the highest-similarity hit above threshold, not just the first match", async () => {
    const client = fakeRedisClient();
    const provider = new RedisCacheProvider(
      { host: "localhost", port: 6379 },
      client,
    );
    // Stored first (would win if the code just returned the first match):
    // similarity to the query [1,0] is only ~0.71.
    await provider.storeSemantic({
      tenantId: "ten_a",
      embedding: [1, 1],
      valueJson: "farther",
    });
    // Stored second: similarity to the query is ~0.995, genuinely closer.
    await provider.storeSemantic({
      tenantId: "ten_a",
      embedding: [0.99, 0.01],
      valueJson: "closest",
    });

    const result = await provider.lookupSemantic({
      tenantId: "ten_a",
      embedding: [1, 0],
      similarityThreshold: 0.9,
    });

    expect(result.hit).toBe(true);
    expect(result.valueJson).toBe("closest");
  });

  it("respects a custom similarity threshold and misses below it", async () => {
    const client = fakeRedisClient();
    const provider = new RedisCacheProvider(
      { host: "localhost", port: 6379 },
      client,
    );
    await provider.storeSemantic({
      tenantId: "ten_a",
      embedding: [1, 0],
      valueJson: "stored",
    });

    const result = await provider.lookupSemantic({
      tenantId: "ten_a",
      embedding: [0, 1],
      similarityThreshold: 0.5,
    });

    expect(result.hit).toBe(false);
  });

  it("ignores malformed entries instead of crashing", async () => {
    const client = fakeRedisClient();
    client.store.set("cache:semantic:ten_a:candidates", ["not-json", "{}"]);
    const provider = new RedisCacheProvider(
      { host: "localhost", port: 6379 },
      client,
    );

    const result = await provider.lookupSemantic({
      tenantId: "ten_a",
      embedding: [1, 0],
    });

    expect(result.hit).toBe(false);
  });

  it("rejects an empty tenantId on lookup and store", async () => {
    const provider = realProvider();
    await expect(
      provider.lookupSemantic({ tenantId: "", embedding: [1] }),
    ).rejects.toThrow("tenantId is required");
    await expect(
      provider.storeSemantic({ tenantId: "", embedding: [1], valueJson: "{}" }),
    ).rejects.toThrow("tenantId is required");
  });

  it("rejects an empty embedding", async () => {
    const provider = realProvider();
    await expect(
      provider.lookupSemantic({ tenantId: "ten_a", embedding: [] }),
    ).rejects.toThrow("embedding must not be empty");
  });

  it("requires a non-empty host and valid port at construction", () => {
    expect(() => new RedisCacheProvider({ host: "", port: 6379 })).toThrow(
      "Redis host is required",
    );
    expect(
      () => new RedisCacheProvider({ host: "localhost", port: 0 }),
    ).toThrow("Redis port must be");
  });

  it("reports unhealthy when the ping fails", async () => {
    const client = fakeRedisClient();
    client.ping = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const provider = new RedisCacheProvider(
      { host: "localhost", port: 6379 },
      client,
    );

    const health = await provider.healthCheck();
    expect(health.status).toBe("unhealthy");
  });

  it("closes the underlying client", async () => {
    const client = fakeRedisClient();
    const provider = new RedisCacheProvider(
      { host: "localhost", port: 6379 },
      client,
    );
    await provider.close();
    expect(client.quit).toHaveBeenCalled();
  });
});
