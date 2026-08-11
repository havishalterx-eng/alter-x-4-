export interface AccessTokenProvider {
  getAccessToken(organization?: string): Promise<string>;
}

export interface Auth0M2mTokenProviderOptions {
  readonly tokenUrl: string;
  readonly audience: string;
  readonly clientId: string;
  readonly resolveClientSecret: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

/**
 * Auth0 OAuth client-credentials client for service-to-service calls.
 * Tokens are cached until one minute before expiry and are never logged.
 */
export class Auth0M2mTokenProvider implements AccessTokenProvider {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #cached = new Map<string, CachedToken>();

  constructor(private readonly options: Auth0M2mTokenProviderOptions) {
    if (
      !options.tokenUrl.trim() ||
      !options.audience.trim() ||
      !options.clientId.trim()
    ) {
      throw new Error("Auth0 M2M configuration is incomplete");
    }
    assertSecureTokenUrl(options.tokenUrl);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async getAccessToken(organization?: string): Promise<string> {
    const cacheKey = organization ?? "";
    const cached = this.#cached.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > this.#now() + 60_000) {
      return cached.accessToken;
    }

    const clientSecret = await this.options.resolveClientSecret();
    if (!clientSecret.trim()) {
      throw new Error("Auth0 M2M client secret is empty");
    }
    const response = await this.#fetch(this.options.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.options.clientId,
        client_secret: clientSecret,
        audience: this.options.audience,
        ...(organization === undefined ? {} : { organization }),
      }),
    });
    if (!response.ok) {
      throw new Error(`M2M token request failed with status ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!isTokenResponse(payload)) {
      throw new Error("M2M token response failed validation");
    }
    this.#cached.set(cacheKey, {
      accessToken: payload.access_token,
      expiresAt: this.#now() + payload.expires_in * 1_000,
    });
    return payload.access_token;
  }
}

function assertSecureTokenUrl(tokenUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(tokenUrl);
  } catch {
    throw new Error("Auth0 M2M token URL is invalid");
  }
  const loopback = new Set(["127.0.0.1", "::1", "localhost"]);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback.has(parsed.hostname))) {
    throw new Error("Auth0 M2M token URL must use HTTPS outside loopback tests");
  }
}

export function auth0M2mTokenProviderFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Auth0M2mTokenProvider {
  const tokenUrl = required(environment, "AUTH0_M2M_TOKEN_URL");
  const audience = required(environment, "AUTH0_M2M_AUDIENCE");
  const clientId = required(environment, "AUTH0_M2M_CLIENT_ID");
  const clientSecret = required(environment, "AUTH0_M2M_CLIENT_SECRET");
  return new Auth0M2mTokenProvider({
    tokenUrl,
    audience,
    clientId,
    resolveClientSecret: async () => clientSecret,
  });
}

/**
 * Defers environment validation until an outbound internal RPC needs a token.
 * Health-only startup stays available; an unconfigured caller still fails closed
 * before it can send any gRPC request.
 */
export function lazyAuth0M2mTokenProviderFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AccessTokenProvider {
  let provider: Auth0M2mTokenProvider | undefined;
  return {
    async getAccessToken(organization?: string): Promise<string> {
      provider ??= auth0M2mTokenProviderFromEnvironment(environment);
      return provider.getAccessToken(organization);
    },
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required Auth0 M2M configuration: ${name}`);
  return value;
}

function isTokenResponse(value: unknown): value is {
  readonly access_token: string;
  readonly expires_in: number;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { access_token?: unknown }).access_token === "string" &&
    (value as { access_token: string }).access_token.length > 0 &&
    typeof (value as { expires_in?: unknown }).expires_in === "number" &&
    Number.isInteger((value as { expires_in: number }).expires_in) &&
    (value as { expires_in: number }).expires_in > 0
  );
}
