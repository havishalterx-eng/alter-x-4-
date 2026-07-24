import { APP_GUARD } from "@nestjs/core";
import { SessionGatewayGuard } from "@alterx/auth";
import { describe, expect, it, vi } from "vitest";
import { AppModule } from "./app.module";

interface GlobalGuardProvider {
  readonly provide: symbol;
  readonly useFactory: () => unknown;
}

function globalGuardProvider(): GlobalGuardProvider {
  const providers = Reflect.getMetadata("providers", AppModule) as unknown[];
  const provider = providers.find(
    (candidate): candidate is GlobalGuardProvider =>
      typeof candidate === "object" &&
      candidate !== null &&
      "provide" in candidate &&
      candidate.provide === APP_GUARD,
  );
  if (!provider) {
    throw new Error("Session Gateway APP_GUARD is not registered");
  }
  return provider;
}

describe("AppModule Session Gateway registration", () => {
  it("registers the Session Gateway globally and fails on missing config", () => {
    const provider = globalGuardProvider();
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
    const config = {
      AUTH0_DOMAIN: "tenant.auth0.com",
      AUTH0_API_AUDIENCE: "alter-engine",
      ACTOR_TOKEN_ISSUER: "alter-platform-api.identity-broker",
      ACTOR_TOKEN_AUDIENCE: "alter-engine",
      ACTOR_TOKEN_JWKS_URL:
        "https://identity.alter.dev/.well-known/jwks.json",
      REDIS_ENDPOINT: "redis://localhost:6379",
      ORCHESTRATION_DATABASE_HOST: "localhost",
      ORCHESTRATION_DATABASE_PORT: "5432",
      ORCHESTRATION_DATABASE_NAME: "orchestration_db",
      ORCHESTRATION_DATABASE_USER: "orchestration_service",
      AWS_REGION: "ap-south-1",
    };
    for (const [name, value] of Object.entries(config)) {
      vi.stubEnv(name, value);
    }
    try {
      expect(globalGuardProvider().useFactory()).toBeInstanceOf(
        SessionGatewayGuard,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
