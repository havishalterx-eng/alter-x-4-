import {
  ActorTokenClaimsSchema,
  type ActorTokenClaims,
} from "@alterx/contracts";
import { CachedJwks, type JwksFetch, verifyRs256 } from "./jwt";
import {
  SessionGatewayAuthError,
  type ActorTokenValidationResult,
  type ReplayStore,
} from "./types";

const MAX_LIFETIME_SECONDS = 300;
const REPLAY_KEY_PREFIX = "blackboard:actor_jti:";

export interface ActorTokenValidatorConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly jwksCacheTtlMs?: number;
}

export class ActorTokenValidator {
  readonly #config: ActorTokenValidatorConfig;
  readonly #jwks: CachedJwks;
  readonly #replayStore: ReplayStore;
  readonly #nowSeconds: () => number;

  constructor(
    config: ActorTokenValidatorConfig,
    replayStore: ReplayStore,
    dependencies: {
      readonly fetch?: JwksFetch;
      readonly nowSeconds?: () => number;
    } = {},
  ) {
    if (!config.issuer.trim() || !config.audience.trim() || !config.jwksUrl.trim()) {
      throw new Error("Session Gateway actor-token configuration is incomplete");
    }
    this.#config = config;
    this.#jwks = new CachedJwks(
      config.jwksUrl,
      dependencies.fetch,
      config.jwksCacheTtlMs,
    );
    this.#replayStore = replayStore;
    this.#nowSeconds =
      dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async validate(token: string): Promise<ActorTokenValidationResult> {
    let rawClaims: Readonly<Record<string, unknown>>;
    try {
      rawClaims = await verifyRs256(token, this.#jwks);
    } catch {
      throw new SessionGatewayAuthError("AUTH_INVALID_ACTOR_TOKEN");
    }

    if (
      rawClaims.iss !== this.#config.issuer ||
      rawClaims.aud !== this.#config.audience
    ) {
      throw new SessionGatewayAuthError("AUTH_INVALID_ACTOR_TOKEN");
    }

    if (
      typeof rawClaims.iat !== "number" ||
      typeof rawClaims.exp !== "number" ||
      !Number.isInteger(rawClaims.iat) ||
      !Number.isInteger(rawClaims.exp)
    ) {
      throw new SessionGatewayAuthError("AUTH_INVALID_ACTOR_TOKEN");
    }
    if (rawClaims.exp - rawClaims.iat > MAX_LIFETIME_SECONDS) {
      throw new SessionGatewayAuthError(
        "AUTH_ACTOR_TOKEN_LIFETIME_EXCEEDED",
      );
    }

    const now = this.#nowSeconds();
    if (rawClaims.exp <= now) {
      throw new SessionGatewayAuthError("AUTH_ACTOR_TOKEN_EXPIRED");
    }

    const parsed = ActorTokenClaimsSchema.safeParse(rawClaims);
    if (!parsed.success) {
      throw new SessionGatewayAuthError("AUTH_INVALID_ACTOR_TOKEN");
    }

    const remainingLifetime = Math.max(1, Math.ceil(parsed.data.exp - now));
    const firstUse = await this.#replayStore.setIfAbsent(
      `${REPLAY_KEY_PREFIX}${parsed.data.jti}`,
      remainingLifetime,
    );
    if (!firstUse) {
      throw new SessionGatewayAuthError("AUTH_ACTOR_TOKEN_REPLAY");
    }

    return {
      claims: parsed.data,
      actorContext: actorContext(parsed.data),
    };
  }
}

function actorContext(claims: ActorTokenClaims) {
  return {
    actor_type: "user" as const,
    user_id: claims.user_id,
    tenant_id: claims.tenant_id,
    workspace_id: claims.workspace_id,
    roles: claims.roles,
    permissions: claims.permissions,
    session_id: claims.session_id,
    jti: claims.jti,
  };
}
