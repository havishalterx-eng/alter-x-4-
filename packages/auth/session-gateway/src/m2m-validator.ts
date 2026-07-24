import { CachedJwks, type JwksFetch, verifyRs256 } from "./jwt";
import {
  SessionGatewayAuthError,
  type ActorContext,
  type ValidatedMachineToken,
} from "./types";

const ACTOR_TYPE_CLAIM = "https://alter.dev/claims/actor_type";

export interface M2mValidatorConfig {
  readonly auth0Domain: string;
  readonly apiAudience: string;
  readonly jwksCacheTtlMs?: number;
}

export class M2mValidator {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #jwks: CachedJwks;
  readonly #nowSeconds: () => number;

  constructor(
    config: M2mValidatorConfig,
    dependencies: {
      readonly fetch?: JwksFetch;
      readonly nowSeconds?: () => number;
    } = {},
  ) {
    const domain = config.auth0Domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!domain || !config.apiAudience.trim()) {
      throw new Error("Session Gateway M2M configuration is incomplete");
    }
    this.#issuer = `https://${domain}/`;
    this.#audience = config.apiAudience;
    this.#jwks = new CachedJwks(
      `${this.#issuer}.well-known/jwks.json`,
      dependencies.fetch,
      config.jwksCacheTtlMs,
    );
    this.#nowSeconds =
      dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async validate(authorization: string | undefined): Promise<ValidatedMachineToken> {
    try {
      const token = bearerToken(authorization);
      const claims = await verifyRs256(token, this.#jwks);
      if (
        claims.iss !== this.#issuer ||
        !hasAudience(claims.aud, this.#audience) ||
        typeof claims.exp !== "number" ||
        !Number.isInteger(claims.exp) ||
        claims.exp <= this.#nowSeconds()
      ) {
        throw new Error("Invalid machine token claims");
      }

      return {
        claims,
        serviceActor:
          claims[ACTOR_TYPE_CLAIM] === "service"
            ? serviceActorContext(claims)
            : null,
      };
    } catch {
      throw new SessionGatewayAuthError("AUTH_INVALID_M2M_TOKEN");
    }
  }
}

function bearerToken(authorization: string | undefined): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("Missing bearer token");
  }
  return token;
}

function hasAudience(claim: unknown, expected: string): boolean {
  return claim === expected || (Array.isArray(claim) && claim.includes(expected));
}

function serviceActorContext(
  claims: Readonly<Record<string, unknown>>,
): ActorContext {
  if (typeof claims.tenant_id !== "string" || claims.tenant_id.length === 0) {
    throw new Error("Service token has no tenant");
  }
  return {
    actor_type: "service",
    user_id: null,
    tenant_id: claims.tenant_id,
    workspace_id:
      typeof claims.workspace_id === "string" ? claims.workspace_id : null,
    roles: stringArray(claims.roles),
    permissions: stringArray(claims.permissions),
    session_id: null,
    jti: null,
  };
}

function stringArray(value: unknown): readonly string[] {
  if (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  ) {
    return (value ?? []) as string[];
  }
  throw new Error("Invalid service actor claims");
}
