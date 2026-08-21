import {
  createPublicKey,
  createVerify,
  type JsonWebKey as NodeJsonWebKey,
  type KeyObject,
} from "node:crypto";
import type { JsonWebKey, JsonWebKeySet } from "./types";

interface JwtHeader {
  readonly alg: string;
  readonly kid: string;
}

export interface DecodedJwt {
  readonly header: JwtHeader;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly signingInput: string;
  readonly signature: Buffer;
}

export type JwksFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

export class CachedJwks {
  readonly #keys = new Map<string, KeyObject>();
  readonly #fetch: JwksFetch;
  readonly #url: string;
  readonly #ttlMs: number;
  readonly #missCooldownMs: number;
  #expiresAt = 0;
  #missCooldownUntil = 0;

  constructor(
    url: string,
    fetcher: JwksFetch = fetch,
    ttlMs = 300_000,
    missCooldownMs = 30_000,
  ) {
    this.#url = url;
    this.#fetch = fetcher;
    this.#ttlMs = ttlMs;
    this.#missCooldownMs = missCooldownMs;
  }

  async key(kid: string): Promise<KeyObject> {
    if (Date.now() >= this.#expiresAt) {
      await this.#refresh();
    }

    const cached = this.#keys.get(kid);
    if (cached) {
      return cached;
    }

    if (Date.now() < this.#missCooldownUntil) {
      // An unauthenticated caller can present a JWT with any kid at all.
      // Refreshing on every cache miss turns an unlimited stream of bogus
      // kids into an unlimited stream of outbound JWKS fetches -- Auth0
      // rate-limits the tenant, #refresh() starts throwing, and every
      // authentication in every service fails. A confirmed-missing kid
      // stays missing until the next real refresh; there's nothing a
      // second fetch this soon could learn.
      throw new Error("Unknown signing key");
    }

    await this.#refresh();
    this.#missCooldownUntil = Date.now() + this.#missCooldownMs;
    const rotated = this.#keys.get(kid);
    if (!rotated) {
      throw new Error("Unknown signing key");
    }
    return rotated;
  }

  async #refresh(): Promise<void> {
    const response = await this.#fetch(this.#url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("JWKS unavailable");
    }
    const body = (await response.json()) as JsonWebKeySet;
    if (!Array.isArray(body.keys)) {
      throw new Error("Invalid JWKS");
    }

    const next = new Map<string, KeyObject>();
    for (const key of body.keys) {
      if (isUsableRsaKey(key)) {
        next.set(
          key.kid,
          createPublicKey({
            key: {
              kty: key.kty,
              kid: key.kid,
              n: key.n,
              e: key.e,
              ...(key.alg ? { alg: key.alg } : {}),
              ...(key.use ? { use: key.use } : {}),
            } as NodeJsonWebKey,
            format: "jwk",
          }),
        );
      }
    }
    this.#keys.clear();
    for (const [kid, key] of next) {
      this.#keys.set(kid, key);
    }
    this.#expiresAt = Date.now() + this.#ttlMs;
  }
}

function isUsableRsaKey(
  key: JsonWebKey,
): key is JsonWebKey & Required<Pick<JsonWebKey, "kid" | "n" | "e">> {
  return (
    key.kty === "RSA" &&
    typeof key.kid === "string" &&
    key.kid.length > 0 &&
    typeof key.n === "string" &&
    typeof key.e === "string" &&
    (key.alg === undefined || key.alg === "RS256") &&
    (key.use === undefined || key.use === "sig")
  );
}

export function decodeJwt(token: string): DecodedJwt {
  const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra !== undefined) {
    throw new Error("Malformed JWT");
  }

  const header = parseJson(encodedHeader) as Partial<JwtHeader>;
  const claims = parseJson(encodedPayload) as Record<string, unknown>;
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !isRecord(claims)) {
    throw new Error("Unsupported JWT");
  }

  return {
    header: { alg: header.alg, kid: header.kid },
    claims,
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: Buffer.from(encodedSignature, "base64url"),
  };
}

export async function verifyRs256(
  token: string,
  jwks: CachedJwks,
): Promise<Readonly<Record<string, unknown>>> {
  const decoded = decodeJwt(token);
  const key = await jwks.key(decoded.header.kid);
  const valid = createVerify("RSA-SHA256")
    .update(decoded.signingInput)
    .verify(key, decoded.signature);
  if (!valid) {
    throw new Error("Invalid JWT signature");
  }
  return decoded.claims;
}

function parseJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
