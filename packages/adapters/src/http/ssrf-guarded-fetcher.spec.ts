import { describe, expect, it, vi } from "vitest";

import { SsrfGuardedFetcher, type FetchFn, type ResolvedAddress } from "./ssrf-guarded-fetcher";

function jsonBody(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
}

function dnsResolverFor(
  map: Record<string, readonly ResolvedAddress[]>,
): (hostname: string) => Promise<readonly ResolvedAddress[]> {
  return async (hostname) => {
    const addresses = map[hostname];
    if (addresses === undefined) {
      throw new Error(`no fixture DNS entry for ${hostname}`);
    }
    return addresses;
  };
}

describe("SsrfGuardedFetcher", () => {
  it("fetches a public URL successfully", async () => {
    const fetchFn: FetchFn = vi.fn(async () => ({
      status: 200,
      headers: { get: () => null },
      body: undefined,
      arrayBuffer: async () => jsonBody({ ok: true }),
    }));
    const fetcher = new SsrfGuardedFetcher(
      {},
      dnsResolverFor({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
      fetchFn,
    );

    const result = await fetcher.fetch("https://example.com/path");

    expect(result.statusCode).toBe(200);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.com/path",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it("pins each request to the validated DNS address", async () => {
    const fetchFn: FetchFn = vi.fn(async (_url, init) => {
      const resolved = await new Promise<{ address: string; family: number }>(
        (resolve, reject) => {
          init.lookup("rebind.example.com", {}, (error: NodeJS.ErrnoException | null, address: string | import("node:dns").LookupAddress[], family?: number) => {
            if (error || typeof address !== "string" || family === undefined) {
              reject(error ?? new Error("lookup did not return an address"));
              return;
            }
            resolve({ address, family });
          });
        },
      );
      expect(resolved).toEqual({ address: "93.184.216.34", family: 4 });
      return {
        status: 200,
        headers: { get: () => null },
        body: undefined,
        arrayBuffer: async () => jsonBody({ ok: true }),
      };
    });
    const resolveDns = vi.fn(
      dnsResolverFor({
        "rebind.example.com": [{ address: "93.184.216.34", family: 4 }],
      }),
    );
    const fetcher = new SsrfGuardedFetcher({}, resolveDns, fetchFn);

    await expect(fetcher.fetch("https://rebind.example.com/path")).resolves.toMatchObject({
      statusCode: 200,
    });
    expect(resolveDns).toHaveBeenCalledTimes(1);
  });

  it("blocks a URL whose hostname resolves to a private IP", async () => {
    const fetchFn: FetchFn = vi.fn();
    const fetcher = new SsrfGuardedFetcher(
      {},
      dnsResolverFor({ "internal.example.com": [{ address: "10.0.0.5", family: 4 }] }),
      fetchFn,
    );

    await expect(
      fetcher.fetch("https://internal.example.com/"),
    ).rejects.toThrow(/blocked private\/internal IP/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks the [::ffff:127.0.0.1] literal even after the URL parser normalizes it to hex-group form", async () => {
    // new URL("https://[::ffff:127.0.0.1]/").hostname normalizes to
    // "[::ffff:7f00:1]" -- this proves the whole fetch path (not just the
    // isolated guard function) rejects that normalized form.
    const fetchFn: FetchFn = vi.fn();
    const fetcher = new SsrfGuardedFetcher({}, dnsResolverFor({}), fetchFn);

    await expect(
      fetcher.fetch("https://[::ffff:127.0.0.1]/"),
    ).rejects.toThrow(/blocked private\/internal IPv6/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks a literal AWS metadata IP even without DNS resolution", async () => {
    const fetchFn: FetchFn = vi.fn();
    const fetcher = new SsrfGuardedFetcher({}, dnsResolverFor({}), fetchFn);

    await expect(
      fetcher.fetch("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/blocked private\/internal IPv4/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a non-https scheme by default", async () => {
    const fetchFn: FetchFn = vi.fn();
    const fetcher = new SsrfGuardedFetcher(
      {},
      dnsResolverFor({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
      fetchFn,
    );

    await expect(fetcher.fetch("http://example.com/")).rejects.toThrow(
      /scheme/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("re-validates every redirect hop and follows a safe redirect", async () => {
    const fetchFn: FetchFn = vi.fn(async (url) => {
      if (url === "https://example.com/start") {
        return {
          status: 302,
          headers: { get: (name: string) => (name === "location" ? "https://safe.example.com/end" : null) },
          body: undefined,
          arrayBuffer: async () => jsonBody({}),
        };
      }
      return {
        status: 200,
        headers: { get: () => null },
        body: undefined,
        arrayBuffer: async () => jsonBody({ ok: true }),
      };
    });
    const fetcher = new SsrfGuardedFetcher(
      {},
      dnsResolverFor({
        "example.com": [{ address: "93.184.216.34", family: 4 }],
        "safe.example.com": [{ address: "93.184.216.35", family: 4 }],
      }),
      fetchFn,
    );

    const result = await fetcher.fetch("https://example.com/start");

    expect(result.statusCode).toBe(200);
    expect(result.finalUrl).toBe("https://safe.example.com/end");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("blocks a redirect that points at an internal address", async () => {
    const fetchFn: FetchFn = vi.fn(async () => ({
      status: 302,
      headers: {
        get: (name: string) =>
          name === "location" ? "https://internal.example.com/secret" : null,
      },
      body: undefined,
      arrayBuffer: async () => jsonBody({}),
    }));
    const fetcher = new SsrfGuardedFetcher(
      {},
      dnsResolverFor({
        "example.com": [{ address: "93.184.216.34", family: 4 }],
        "internal.example.com": [{ address: "10.0.0.9", family: 4 }],
      }),
      fetchFn,
    );

    await expect(fetcher.fetch("https://example.com/start")).rejects.toThrow(
      /blocked private\/internal IP/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("gives up after exceeding the maximum redirect count", async () => {
    const fetchFn: FetchFn = vi.fn(async () => ({
      status: 302,
      headers: {
        get: (name: string) =>
          name === "location" ? "https://example.com/loop" : null,
      },
      body: undefined,
      arrayBuffer: async () => jsonBody({}),
    }));
    const fetcher = new SsrfGuardedFetcher(
      { maxRedirects: 2 },
      dnsResolverFor({ "example.com": [{ address: "93.184.216.34", family: 4 }] }),
      fetchFn,
    );

    await expect(fetcher.fetch("https://example.com/loop")).rejects.toThrow(
      /exceeded the maximum/,
    );
  });

  it("rejects when the hostname resolves to no addresses", async () => {
    const fetchFn: FetchFn = vi.fn();
    const fetcher = new SsrfGuardedFetcher(
      {},
      dnsResolverFor({ "example.com": [] }),
      fetchFn,
    );

    await expect(fetcher.fetch("https://example.com/")).rejects.toThrow(
      /did not resolve to any address/,
    );
  });

  it("rejects declared oversized bodies before buffering them", async () => {
    const arrayBuffer = vi.fn(async () => jsonBody({ tooLarge: true }));
    const fetcher = new SsrfGuardedFetcher(
      { maxResponseBytes: 8 },
      dnsResolverFor({
        "example.com": [{ address: "93.184.216.34", family: 4 }],
      }),
      vi.fn(async () => ({
        status: 200,
        headers: {
          get: (name: string) => (name === "content-length" ? "9" : null),
        },
        body: undefined,
        arrayBuffer,
      })),
    );

    await expect(fetcher.fetch("https://example.com/")).rejects.toThrow(
      "byte limit",
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("cancels a chunked body as soon as streamed bytes cross the limit", async () => {
    const cancel = vi.fn(async () => undefined);
    const chunks = [
      { done: false, value: new Uint8Array([1, 2, 3, 4]) },
      { done: false, value: new Uint8Array([5, 6, 7, 8, 9]) },
    ];
    const fetcher = new SsrfGuardedFetcher(
      { maxResponseBytes: 8 },
      dnsResolverFor({
        "example.com": [{ address: "93.184.216.34", family: 4 }],
      }),
      vi.fn(async () => ({
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () =>
              chunks.shift() ?? { done: true as const, value: undefined },
            cancel,
          }),
        },
        arrayBuffer: async () => jsonBody("must not buffer"),
      })),
    );

    await expect(fetcher.fetch("https://example.com/")).rejects.toThrow(
      "byte limit",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});
