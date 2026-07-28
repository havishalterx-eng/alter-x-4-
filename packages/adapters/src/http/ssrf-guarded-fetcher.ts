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
  readonly body: {
    getReader(): {
      read(): Promise<{
        readonly done: boolean;
        readonly value: Uint8Array | undefined;
      }>;
      cancel?(): Promise<void>;
    };
  } | null | undefined;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface SsrfGuardedFetcherConfig {
  readonly maxRedirects?: number;
  readonly maxResponseBytes?: number;
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
  readonly #maxResponseBytes: number;
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
    this.#maxResponseBytes =
      config.maxResponseBytes ?? Number.MAX_SAFE_INTEGER;
    if (
      !Number.isSafeInteger(this.#maxResponseBytes) ||
      this.#maxResponseBytes < 1
    ) {
      throw new Error("URL fetch maxResponseBytes must be a positive integer");
    }
    this.#policy = config.policy ?? {};
    this.#resolveDns = resolveDns ?? defaultDnsResolver;
    this.#fetchFn = fetchFn ?? defaultFetchFn();
  }

  async fetch(rawUrl: string): Promise<SsrfGuardedFetchResult> {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= this.#maxRedirects; hop += 1) {
      await this.assertAllowed(currentUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.#fetchFn(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
        });
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

        const body = await readBoundedBody(response, this.#maxResponseBytes);
        return { statusCode: response.status, body, finalUrl: currentUrl };
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(
      `URL fetch exceeded the maximum of ${this.#maxRedirects} redirects`,
    );
  }

  async assertAllowed(rawUrl: string): Promise<void> {
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

async function readBoundedBody(
  response: Awaited<ReturnType<FetchFn>>,
  maxResponseBytes: number,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxResponseBytes) {
      throw new Error("URL fetch response exceeds configured byte limit");
    }
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const body = await response.arrayBuffer();
    if (body.byteLength > maxResponseBytes) {
      throw new Error("URL fetch response exceeds configured byte limit");
    }
    return body;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel?.();
      throw new Error("URL fetch response exceeds configured byte limit");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}
