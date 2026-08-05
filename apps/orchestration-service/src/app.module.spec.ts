import { APP_GUARD } from "@nestjs/core";
import {
  SessionGatewayGuard,
  SessionGatewayRateLimitGuard,
  SessionGatewayUploadAllowlistGuard,
} from "@alterx/auth";
import { describe, expect, it, vi } from "vitest";
import { AppModule } from "./app.module";

interface GlobalGuardProvider {
  readonly provide: symbol;
  readonly useFactory: () => unknown;
}

function globalGuardProviders(): readonly GlobalGuardProvider[] {
  const providers = Reflect.getMetadata("providers", AppModule) as unknown[];
  const guards = providers.filter(
    (candidate): candidate is GlobalGuardProvider =>
      typeof candidate === "object" &&
      candidate !== null &&
      "provide" in candidate &&
      candidate.provide === APP_GUARD,
  );
  if (guards.length === 0) {
    throw new Error("Session Gateway APP_GUARD is not registered");
  }
  return guards;
}

const VALID_CONFIG = {
  AUTH0_DOMAIN: "tenant.auth0.com",
  AUTH0_API_AUDIENCE: "alter-engine",
  ACTOR_TOKEN_ISSUER: "alter-platform-api.identity-broker",
  ACTOR_TOKEN_AUDIENCE: "alter-engine",
  ACTOR_TOKEN_JWKS_URL: "https://identity.example.test/actor-jwks",
  REDIS_ENDPOINT: "redis://localhost:6379",
  ORCHESTRATION_DATABASE_HOST: "localhost",
  ORCHESTRATION_DATABASE_PORT: "5432",
  ORCHESTRATION_DATABASE_NAME: "orchestration_db",
  ORCHESTRATION_DATABASE_USER: "orchestration_service",
  AWS_REGION: "ap-south-1",
  ALTER_ARTIFACTS_BUCKET_PARAM: "/alter/local/orchestration/artifacts-bucket",
} as const;

function stubConfig(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({
    ...VALID_CONFIG,
    ...overrides,
  })) {
    vi.stubEnv(name, value);
  }
}

describe("AppModule Session Gateway registration", () => {
  it("registers the Session Gateway globally and fails on missing config", () => {
    const provider = globalGuardProviders()[0]!;
    expect(provider.provide).toBe(APP_GUARD);
    vi.stubEnv("AUTH0_DOMAIN", "");
    try {
      expect(provider.useFactory).toThrow(
        "Missing required Session Gateway configuration",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("builds the guard when all required references are present", () => {
    stubConfig();
    try {
      expect(globalGuardProviders()[0]!.useFactory()).toBeInstanceOf(
        SessionGatewayGuard,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("registers rate limiting and upload validation after authentication", () => {
    stubConfig();
    try {
      const guards = globalGuardProviders();
      expect(guards).toHaveLength(3);
      expect(guards[0]!.useFactory()).toBeInstanceOf(SessionGatewayGuard);
      expect(guards[1]!.useFactory()).toBeInstanceOf(
        SessionGatewayRateLimitGuard,
      );
      expect(guards[2]!.useFactory()).toBeInstanceOf(
        SessionGatewayUploadAllowlistGuard,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails closed when production feature flag is not enabled", () => {
    stubConfig({ NODE_ENV: "production" });
    try {
      expect(globalGuardProviders()[0]!.useFactory).toThrow(
        "Production Session Gateway requires feature flag ingress.sessionGatewayCore",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails closed when production actor-token JWKS configuration is missing", () => {
    stubConfig({
      NODE_ENV: "production",
      INGRESS_SESSION_GATEWAY_CORE_ENABLED: "true",
      ACTOR_TOKEN_JWKS_URL: "",
    });
    try {
      expect(globalGuardProviders()[0]!.useFactory).toThrow(
        "Missing required Session Gateway configuration: ACTOR_TOKEN_JWKS_URL",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects test signer activation in production", () => {
    stubConfig({
      NODE_ENV: "production",
      INGRESS_SESSION_GATEWAY_CORE_ENABLED: "true",
      ACTOR_TOKEN_TEST_SIGNER_ENABLED: "true",
    });
    try {
      expect(globalGuardProviders()[0]!.useFactory).toThrow(
        "Actor-token test signer cannot be enabled in production",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("builds the guard in production when rollout gates are configured", () => {
    stubConfig({
      NODE_ENV: "production",
      INGRESS_SESSION_GATEWAY_CORE_ENABLED: "true",
    });
    try {
      expect(globalGuardProviders()[0]!.useFactory()).toBeInstanceOf(
        SessionGatewayGuard,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
