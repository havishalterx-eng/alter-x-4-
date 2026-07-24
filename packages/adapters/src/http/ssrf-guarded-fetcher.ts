import { lookup as dnsLookup } from "node:dns/promises";

import {
  assertHostnameNotLiteralBlockedIp,
  assertResolvedAddressesNotBlocked,
  assertUrlSchemeAllowed,
  type SsrfGuardPolicy,
} from "./ssrf-guard";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type DnsResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type FetchFn = (
  url: string,
  init: { readonly method: string; readonly redirect: "manual"; readonly signal: AbortSignal },
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: unknown;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface SsrfGuardedFetcherConfig {
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly policy?: SsrfGuardPolicy;
}

export interface SsrfGuardedFetchResult {
  readonly statusCode: number;
  readonly body: ArrayBuffer;
  readonly finalUrl: string;
}

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

async function defaultDnsResolver(hostname: string): Promise<readonly ResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));
}

function defaultFetchFn(): FetchFn {
  return (url, init) => fetch(url, init) as unknown as ReturnType<FetchFn>;
}

export class SsrfGuardedFetcher {
  readonly #maxRedirects: number;
  readonly #timeoutMs: number;
  readonly #policy: SsrfGuardPolicy;
  readonly #resolveDns: DnsResolver;
  readonly #fetchFn: FetchFn;

  constructor(
    config: SsrfGuardedFetcherConfig = {},
    resolveDns?: DnsResolver,
    fetchFn?: FetchFn,
  ) {
    this.#maxRedirects = config.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#policy = config.policy ?? {};
    this.#resolveDns = resolveDns ?? defaultDnsResolver;
    this.#fetchFn = fetchFn ?? defaultFetchFn();
  }

  async fetch(rawUrl: string): Promise<SsrfGuardedFetchResult> {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= this.#maxRedirects; hop += 1) {
      await this.#validateTarget(currentUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      let response: Awaited<ReturnType<FetchFn>>;
      try {
        response = await this.#fetchFn(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null || location.length === 0) {
          throw new Error(
            `Redirect response ${response.status} from ${currentUrl} carried no Location header`,
          );
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const body = await response.arrayBuffer();
      return { statusCode: response.status, body, finalUrl: currentUrl };
    }
    throw new Error(
      `URL fetch exceeded the maximum of ${this.#maxRedirects} redirects`,
    );
  }

  async #validateTarget(rawUrl: string): Promise<void> {
    const url = new URL(rawUrl);
    assertUrlSchemeAllowed(url, this.#policy);
    assertHostnameNotLiteralBlockedIp(url.hostname);
    const addresses = await this.#resolveDns(url.hostname);
    if (addresses.length === 0) {
      throw new Error(`URL host ${url.hostname} did not resolve to any address`);
    }
    assertResolvedAddressesNotBlocked(addresses);
  }
}
