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
        MARKETPLACE_DATABASE_URL:
          "postgres://platform_api:platform_api_local@localhost:5432/marketplace_db",
        ACTOR_TOKEN_SIGNING_KEY_REF: "env:ACTOR_TOKEN_PRIVATE_KEY",
        REDIS_ENDPOINT_PARAM: "/alter/dev/platform-api/redis-endpoint",
        ALTER_CONFIG_SOURCE: "local-file",
      }),
    ).toEqual({
      DATABASE_URL: "postgres://platform_api:platform_api_local@localhost:5432/platform_db",
      MARKETPLACE_DATABASE_URL:
        "postgres://platform_api:platform_api_local@localhost:5432/marketplace_db",
      ACTOR_TOKEN_SIGNING_KEY_REF: "env:ACTOR_TOKEN_PRIVATE_KEY",
      IDENTITY_PROVIDER: "mock",
      REDIS_ENDPOINT_PARAM: "/alter/dev/platform-api/redis-endpoint",
      SIGNING_KEY_PROVIDER: "secrets",
      ALTER_CONFIG_SOURCE: "local-file",
      MARKETPLACE_OBJECT_STORAGE_PROVIDER: "mock",
      REGISTRY_SCAN_PROVIDER: "mock",
      STATUS_PAGE_PROVIDER: "mock",
    });
  });

  it("requires Auth0 refs when Auth0 provider is selected", () => {
    expect(() =>
      validatePlatformApiEnv({
        DATABASE_URL: "postgres://platform_api:platform_api_local@localhost:5432/platform_db",
        MARKETPLACE_DATABASE_URL:
          "postgres://platform_api:platform_api_local@localhost:5432/marketplace_db",
        ACTOR_TOKEN_SIGNING_KEY_REF: "env:ACTOR_TOKEN_PRIVATE_KEY",
        IDENTITY_PROVIDER: "auth0",
      }),
    ).toThrow("AUTH0_DOMAIN required when IDENTITY_PROVIDER=auth0");
  });

  it("allows explicit test mock mode without a secret reference", () => {
    expect(
      validatePlatformApiEnv({
        DATABASE_URL: "postgres://platform_api:platform_api_local@localhost:5432/platform_db",
        MARKETPLACE_DATABASE_URL:
          "postgres://platform_api:platform_api_local@localhost:5432/marketplace_db",
        SIGNING_KEY_PROVIDER: "mock",
      }),
    ).toMatchObject({ SIGNING_KEY_PROVIDER: "mock" });
  });

  it("requires AppConfig identifiers in appconfig mode", () => {
    expect(() =>
      validatePlatformApiEnv({
        DATABASE_URL: "postgres://localhost/platform_db",
        MARKETPLACE_DATABASE_URL: "postgres://localhost/marketplace_db",
        ALTER_CONFIG_SOURCE: "appconfig",
      }),
    ).toThrow("APPCONFIG_APP_ID required");
  });

  it("selects marketplace object storage explicitly", () => {
    const base = { DATABASE_URL: "postgres://localhost/platform_db", MARKETPLACE_DATABASE_URL: "postgres://localhost/marketplace_db", SIGNING_KEY_PROVIDER: "mock" };
    expect(validatePlatformApiEnv(base).MARKETPLACE_OBJECT_STORAGE_PROVIDER).toBe("mock");
    expect(validatePlatformApiEnv({ ...base, MARKETPLACE_OBJECT_STORAGE_PROVIDER: "s3", AWS_REGION: "ap-south-1" }).MARKETPLACE_OBJECT_STORAGE_PROVIDER).toBe("s3");
    expect(() => validatePlatformApiEnv({ ...base, MARKETPLACE_OBJECT_STORAGE_PROVIDER: "gcs" })).toThrow("Invalid platform-api environment");
    expect(() => validatePlatformApiEnv({ ...base, MARKETPLACE_OBJECT_STORAGE_PROVIDER: "s3" })).toThrow("AWS_REGION required when MARKETPLACE_OBJECT_STORAGE_PROVIDER=s3");
  });

  it("fails loudly until SCAN-1 when sandbox scanning is selected", () => {
    const base = { DATABASE_URL: "postgres://localhost/platform_db", MARKETPLACE_DATABASE_URL: "postgres://localhost/marketplace_db", SIGNING_KEY_PROVIDER: "mock" };
    expect(validatePlatformApiEnv(base).REGISTRY_SCAN_PROVIDER).toBe("mock");
    expect(() => validatePlatformApiEnv({ ...base, REGISTRY_SCAN_PROVIDER: "sandbox" })).toThrow("SCAN-1");
    expect(() => validatePlatformApiEnv({ ...base, REGISTRY_SCAN_PROVIDER: "other" })).toThrow("Invalid platform-api environment");
  });

  it("requires Statuspage identifiers when real publishing is selected", () => {
    const base = {
      DATABASE_URL: "postgres://localhost/platform_db",
      MARKETPLACE_DATABASE_URL: "postgres://localhost/marketplace_db",
      SIGNING_KEY_PROVIDER: "mock",
      STATUS_PAGE_PROVIDER: "atlassian",
    } as const;
    expect(() => validatePlatformApiEnv(base)).toThrow("STATUSPAGE_PAGE_ID required");
    expect(validatePlatformApiEnv({
      ...base,
      STATUSPAGE_PAGE_ID: "page_123",
      STATUSPAGE_API_TOKEN_SECRET_REF: "/alter/statuspage/api-token",
    })).toMatchObject({ STATUS_PAGE_PROVIDER: "atlassian" });
  });

  it("requires model gateway admin URL and token reference together", () => {
    const base = {
      DATABASE_URL: "postgres://localhost/platform_db",
      MARKETPLACE_DATABASE_URL: "postgres://localhost/marketplace_db",
      SIGNING_KEY_PROVIDER: "mock",
    } as const;
    expect(() => validatePlatformApiEnv({
      ...base,
      MODEL_GATEWAY_ADMIN_BASE_URL: "http://model-gateway.test",
    })).toThrow("configured together");
    expect(validatePlatformApiEnv({
      ...base,
      MODEL_GATEWAY_ADMIN_BASE_URL: "http://model-gateway.test",
      MODEL_GATEWAY_ADMIN_TOKEN_REF: "/alter/model-gateway/admin-token",
    })).toMatchObject({
      MODEL_GATEWAY_ADMIN_BASE_URL: "http://model-gateway.test",
      MODEL_GATEWAY_ADMIN_TOKEN_REF: "/alter/model-gateway/admin-token",
    });
  });

  it("requires both privileged Operations database bindings", () => {
    const base = {
      DATABASE_URL: "postgres://localhost/platform_db",
      MARKETPLACE_DATABASE_URL: "postgres://localhost/marketplace_db",
      SIGNING_KEY_PROVIDER: "mock",
    } as const;
    expect(() => validatePlatformApiEnv({
      ...base,
      OPERATIONS_PLATFORM_DATABASE_URL: "postgres://localhost/platform_admin",
    })).toThrow("configured together");
    expect(validatePlatformApiEnv({
      ...base,
      OPERATIONS_PLATFORM_DATABASE_URL: "postgres://localhost/platform_admin",
      OPERATIONS_MARKETPLACE_DATABASE_URL: "postgres://localhost/marketplace_admin",
    })).toMatchObject({
      OPERATIONS_PLATFORM_DATABASE_URL: "postgres://localhost/platform_admin",
      OPERATIONS_MARKETPLACE_DATABASE_URL: "postgres://localhost/marketplace_admin",
    });
  });
});
