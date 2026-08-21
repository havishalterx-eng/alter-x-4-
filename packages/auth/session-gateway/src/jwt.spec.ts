import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testSigningKey, type TestSigningKey } from "../test-utils/jwt-fixture";
import { CachedJwks } from "./jwt";

/**
 * CachedJwks had no dedicated test file before ENGINE-FIX-P3-4 -- it was
 * only ever exercised indirectly through actor-token-validator.spec.ts /
 * m2m-validator.spec.ts, neither of which drives an unknown-kid miss.
 */

let key: TestSigningKey;

beforeEach(() => {
  key = testSigningKey();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function fetcherFor(key: TestSigningKey) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ keys: [key.jwk] }),
  }));
}

describe("CachedJwks", () => {
  it("resolves a known kid after the initial TTL-triggered refresh", async () => {
    const fetcher = fetcherFor(key);
    const jwks = new CachedJwks("https://example.test/jwks", fetcher, 300_000);

    const resolved = await jwks.key(key.kid);

    expect(resolved).toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not refresh again for a second unknown kid within the miss cooldown", async () => {
    // The bug: an unauthenticated caller presenting an unlimited stream of
    // random kids used to trigger an unlimited stream of outbound JWKS
    // fetches -- one #refresh() per miss, no ceiling.
    const fetcher = fetcherFor(key);
    const jwks = new CachedJwks("https://example.test/jwks", fetcher, 300_000, 30_000);
    await jwks.key(key.kid); // warm up: consumes the cold-start TTL refresh
    fetcher.mockClear();

    await expect(jwks.key("unknown-1")).rejects.toThrow("Unknown signing key");
    expect(fetcher).toHaveBeenCalledTimes(1); // the one miss-triggered refresh

    await expect(jwks.key("unknown-2")).rejects.toThrow("Unknown signing key");
    expect(fetcher).toHaveBeenCalledTimes(1); // still 1 -- cooldown suppressed a second refresh for a different bogus kid
  });

  it("refreshes again once the miss cooldown lapses", async () => {
    const fetcher = fetcherFor(key);
    const jwks = new CachedJwks("https://example.test/jwks", fetcher, 300_000, 30_000);
    await jwks.key(key.kid);
    fetcher.mockClear();

    await expect(jwks.key("unknown-1")).rejects.toThrow("Unknown signing key");
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);

    await expect(jwks.key("unknown-2")).rejects.toThrow("Unknown signing key");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("still resolves a legitimately rotated-in key once the normal TTL refresh runs, even mid-cooldown", async () => {
    const fetcher = fetcherFor(key);
    const jwks = new CachedJwks("https://example.test/jwks", fetcher, 10_000, 30_000);
    await jwks.key(key.kid);
    fetcher.mockClear();

    await expect(jwks.key("unknown")).rejects.toThrow("Unknown signing key");
    expect(fetcher).toHaveBeenCalledTimes(1);

    // TTL (10s) elapses before the miss cooldown (30s) does -- the regular
    // periodic refresh path (key()'s first check) still runs on schedule
    // and is not gated by the miss cooldown.
    vi.advanceTimersByTime(10_001);

    const resolved = await jwks.key(key.kid);
    expect(resolved).toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts a rotated-out key on refresh (regression guard, not a bug fix -- .clear() already did this)", async () => {
    const rotatedOut = testSigningKey("rotated-out");
    const rotatedIn = testSigningKey("rotated-in");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [rotatedOut.jwk] }) })
      // Fallback (not "Once"): covers every call after the first, including
      // the miss-triggered refresh the final assertion below causes --
      // reflects a real JWKS endpoint continuing to serve the post-rotation
      // key set on every subsequent fetch.
      .mockResolvedValue({ ok: true, json: async () => ({ keys: [rotatedIn.jwk] }) });
    const jwks = new CachedJwks("https://example.test/jwks", fetcher, 10_000, 30_000);

    await jwks.key(rotatedOut.kid);
    vi.advanceTimersByTime(10_001);
    await expect(jwks.key(rotatedIn.kid)).resolves.toBeDefined();

    // The audit's "rotated keys never evicted" finding does not hold
    // against this code (jwt.ts's #refresh() calls this.#keys.clear()
    // before repopulating) -- confirming that here so a future change
    // can't silently regress it back to a real vulnerability.
    await expect(jwks.key(rotatedOut.kid)).rejects.toThrow("Unknown signing key");
  });
});
