import { describe, expect, it } from "vitest";
import { validatePlatformApiEnv } from "./env.schema";

describe("platformApiEnvSchema", () => {
  it("throws when DATABASE_URL is missing", () => {
    expect(() => validatePlatformApiEnv({})).toThrow(
      "Invalid platform-api environment",
    );
  });

  it("accepts local database URL and reserved Redis parameter", () => {
    expect(
      validatePlatformApiEnv({
        DATABASE_URL: "postgres://platform_api:platform_api_local@localhost:5432/platform_db",
        ACTOR_TOKEN_SIGNING_KEY_REF: "env:ACTOR_TOKEN_PRIVATE_KEY",
        REDIS_ENDPOINT_PARAM: "/alter/dev/platform-api/redis-endpoint",
      }),
    ).toEqual({
      DATABASE_URL: "postgres://platform_api:platform_api_local@localhost:5432/platform_db",
      ACTOR_TOKEN_SIGNING_KEY_REF: "env:ACTOR_TOKEN_PRIVATE_KEY",
      IDENTITY_PROVIDER: "mock",
      REDIS_ENDPOINT_PARAM: "/alter/dev/platform-api/redis-endpoint",
      SIGNING_KEY_PROVIDER: "secrets",
    });
  });

  it("requires Auth0 refs when Auth0 provider is selected", () => {
    expect(() =>
      validatePlatformApiEnv({
        DATABASE_URL: "postgres://platform_api:platform_api_local@localhost:5432/platform_db",
        ACTOR_TOKEN_SIGNING_KEY_REF: "env:ACTOR_TOKEN_PRIVATE_KEY",
        IDENTITY_PROVIDER: "auth0",
      }),
    ).toThrow("AUTH0_DOMAIN required when IDENTITY_PROVIDER=auth0");
  });

  it("allows explicit test mock mode without a secret reference", () => {
    expect(
      validatePlatformApiEnv({
        DATABASE_URL: "postgres://platform_api:platform_api_local@localhost:5432/platform_db",
        SIGNING_KEY_PROVIDER: "mock",
      }),
    ).toMatchObject({ SIGNING_KEY_PROVIDER: "mock" });
  });
});
