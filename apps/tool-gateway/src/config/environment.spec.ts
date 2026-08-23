import { describe, expect, it } from "vitest";

import {
  ToolGatewayConfigurationError,
  loadToolGatewayEnvironment,
} from "./environment";

function environment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ALTER_ENV: "local",
    ALTER_SERVICE_NAME: "tool-gateway",
    ALTER_REGION: "ap-south-1",
    ALTER_CONFIG_SOURCE: "mock",
    ...overrides,
  };
}

describe("loadToolGatewayEnvironment", () => {
  it("validates and returns the documented local mock environment", () => {
    expect(loadToolGatewayEnvironment(environment())).toEqual({
      alterEnvironment: "local",
      serviceName: "tool-gateway",
      region: "ap-south-1",
      configSource: "mock",
      httpPort: 3000,
      grpcBindAddress: "0.0.0.0:50052",
    });
  });

  it("returns AppConfig binding fields for deployed environments", () => {
    expect(
      loadToolGatewayEnvironment(
        environment({
          ALTER_ENV: "prod",
          ALTER_CONFIG_SOURCE: "appconfig",
          APPCONFIG_APPLICATION_ID: "app-1",
          APPCONFIG_ENVIRONMENT_ID: "env-1",
          APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-1",
          TAVILY_API_KEY_SECRET_REF:
            "/alter/prod/tool-gateway/system/tavily-api-key",
          AUDIT_SERVICE_GRPC_ADDRESS: "audit-service:50051",
          CACHE_REDIS_HOST: "cache.internal",
          CACHE_REDIS_PORT: "6379",
          BROWSERBASE_API_KEY_REF:
            "/alter/prod/tool-gateway/system/browserbase-api-key",
          BROWSERBASE_PROJECT_ID: "bb-project-1",
        }),
      ),
    ).toMatchObject({
      configSource: "appconfig",
      appConfigApplicationId: "app-1",
      appConfigEnvironmentId: "env-1",
      appConfigConfigurationProfileId: "profile-1",
      tavilyApiKeySecretRef: "/alter/prod/tool-gateway/system/tavily-api-key",
      auditServiceGrpcAddress: "audit-service:50051",
      cacheRedisHost: "cache.internal",
      cacheRedisPort: 6379,
      browserbaseApiKeyReference:
        "/alter/prod/tool-gateway/system/browserbase-api-key",
      browserbaseProjectId: "bb-project-1",
    });
  });

  it("rejects the mock config source outside local", () => {
    expect(() =>
      loadToolGatewayEnvironment(environment({ ALTER_ENV: "dev" })),
    ).toThrow(/mock config source is only permitted/);
  });

  it("rejects the mock config source when NODE_ENV is production", () => {
    expect(() =>
      loadToolGatewayEnvironment(environment({ NODE_ENV: "production" })),
    ).toThrow(/cannot be selected when NODE_ENV is production/);
  });

  it.each([undefined, "test", "development"])(
    "allows local mock config when NODE_ENV is %s",
    (nodeEnvironment) => {
      expect(
        loadToolGatewayEnvironment(
          environment({ NODE_ENV: nodeEnvironment }),
        ),
      ).toMatchObject({ configSource: "mock" });
    },
  );

  it("accepts validated custom bind ports", () => {
    expect(
      loadToolGatewayEnvironment(
        environment({ PORT: "3100", GRPC_BIND_ADDRESS: "127.0.0.1:51052" }),
      ),
    ).toMatchObject({ httpPort: 3100, grpcBindAddress: "127.0.0.1:51052" });
  });

  it.each([
    ["ALTER_ENV", { ALTER_ENV: "qa" }],
    ["ALTER_SERVICE_NAME", { ALTER_SERVICE_NAME: "tool-gw" }],
    ["ALTER_REGION", { ALTER_REGION: "us-east-1" }],
    ["ALTER_CONFIG_SOURCE", { ALTER_CONFIG_SOURCE: "environment" }],
    ["PORT", { PORT: "0" }],
    ["GRPC_BIND_ADDRESS", { GRPC_BIND_ADDRESS: "localhost:50052" }],
    ["GRPC_BIND_ADDRESS", { GRPC_BIND_ADDRESS: "127.0.0.1:70000" }],
    [
      "APPCONFIG_APPLICATION_ID",
      {
        ALTER_ENV: "dev",
        ALTER_CONFIG_SOURCE: "appconfig",
        APPCONFIG_APPLICATION_ID: "",
        APPCONFIG_ENVIRONMENT_ID: "env-1",
        APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-1",
        TAVILY_API_KEY_SECRET_REF:
          "/alter/prod/tool-gateway/system/tavily-api-key",
        AUDIT_SERVICE_GRPC_ADDRESS: "audit-service:50051",
        CACHE_REDIS_HOST: "cache.internal",
        CACHE_REDIS_PORT: "6379",
      },
    ],
    [
      "TAVILY_API_KEY_SECRET_REF",
      {
        ALTER_ENV: "dev",
        ALTER_CONFIG_SOURCE: "appconfig",
        APPCONFIG_APPLICATION_ID: "app-1",
        APPCONFIG_ENVIRONMENT_ID: "env-1",
        APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-1",
        TAVILY_API_KEY_SECRET_REF: "",
        AUDIT_SERVICE_GRPC_ADDRESS: "audit-service:50051",
        CACHE_REDIS_HOST: "cache.internal",
        CACHE_REDIS_PORT: "6379",
      },
    ],
    [
      "AUDIT_SERVICE_GRPC_ADDRESS",
      {
        ALTER_ENV: "dev",
        ALTER_CONFIG_SOURCE: "appconfig",
        APPCONFIG_APPLICATION_ID: "app-1",
        APPCONFIG_ENVIRONMENT_ID: "env-1",
        APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-1",
        TAVILY_API_KEY_SECRET_REF:
          "/alter/prod/tool-gateway/system/tavily-api-key",
        AUDIT_SERVICE_GRPC_ADDRESS: "",
        CACHE_REDIS_HOST: "cache.internal",
        CACHE_REDIS_PORT: "6379",
      },
    ],
    [
      "CACHE_REDIS_HOST",
      {
        ALTER_ENV: "dev",
        ALTER_CONFIG_SOURCE: "appconfig",
        APPCONFIG_APPLICATION_ID: "app-1",
        APPCONFIG_ENVIRONMENT_ID: "env-1",
        APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-1",
        TAVILY_API_KEY_SECRET_REF:
          "/alter/prod/tool-gateway/system/tavily-api-key",
        AUDIT_SERVICE_GRPC_ADDRESS: "audit-service:50051",
        CACHE_REDIS_HOST: "",
        CACHE_REDIS_PORT: "6379",
      },
    ],
    [
      "CACHE_REDIS_PORT",
      {
        ALTER_ENV: "dev",
        ALTER_CONFIG_SOURCE: "appconfig",
        APPCONFIG_APPLICATION_ID: "app-1",
        APPCONFIG_ENVIRONMENT_ID: "env-1",
        APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-1",
        TAVILY_API_KEY_SECRET_REF:
          "/alter/prod/tool-gateway/system/tavily-api-key",
        AUDIT_SERVICE_GRPC_ADDRESS: "audit-service:50051",
        CACHE_REDIS_HOST: "cache.internal",
        CACHE_REDIS_PORT: "not-a-port",
      },
    ],
  ])("rejects invalid %s", (field, override) => {
    expect(() => loadToolGatewayEnvironment(environment(override))).toThrow(
      ToolGatewayConfigurationError,
    );
    expect(() => loadToolGatewayEnvironment(environment(override))).toThrow(
      field,
    );
  });
});
