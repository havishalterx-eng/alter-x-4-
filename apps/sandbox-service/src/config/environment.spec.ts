import { describe, expect, it } from "vitest";

import { loadSandboxEnvironment } from "./environment";

const BASE = {
  ALTER_ENV: "local",
  ALTER_SERVICE_NAME: "sandbox-service",
  ALTER_REGION: "ap-south-1",
  ALTER_CONFIG_SOURCE: "mock",
  ARTIFACT_CONTENT_SERVICE_ADDRESS: "orchestration-service:50061",
};

describe("loadSandboxEnvironment", () => {
  it("allows mock providers only in local non-production mode", () => {
    expect(loadSandboxEnvironment(BASE)).toEqual({
      alterEnvironment: "local",
      region: "ap-south-1",
      grpcBindAddress: "0.0.0.0:50057",
      artifactContentServiceAddress: "orchestration-service:50061",
      configSource: "mock",
      localMock: true,
    });
    expect(() =>
      loadSandboxEnvironment({ ...BASE, NODE_ENV: "production" }),
    ).toThrow("local non-production");
    expect(() =>
      loadSandboxEnvironment({ ...BASE, ALTER_ENV: "dev" }),
    ).toThrow("local non-production");
  });

  it("requires all real provider references without resolving secret values", () => {
    const environment = loadSandboxEnvironment({
      ...BASE,
      ALTER_ENV: "prod",
      ALTER_CONFIG_SOURCE: "appconfig",
      APPCONFIG_APPLICATION_ID: "app-id",
      APPCONFIG_ENVIRONMENT_ID: "env-id",
      APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-id",
      E2B_API_KEY_REF: "/alter/prod/sandbox-service/system/e2b-api-key",
      BROWSERBASE_API_KEY_REF:
        "/alter/prod/sandbox-service/system/browserbase-api-key",
      BROWSERBASE_PROJECT_ID: "browserbase-project",
    });

    expect(environment).toMatchObject({
      configSource: "appconfig",
      sandboxProvider: "e2b",
      browserbaseApiKeyReference:
        "/alter/prod/sandbox-service/system/browserbase-api-key",
      browserbaseProjectId: "browserbase-project",
    });
    expect(JSON.stringify(environment)).not.toContain("resolved-secret");
  });

  it("selects the AgentCore sandbox provider without requiring an E2B key", () => {
    const environment = loadSandboxEnvironment({
      ...BASE,
      ALTER_ENV: "prod",
      ALTER_CONFIG_SOURCE: "appconfig",
      APPCONFIG_APPLICATION_ID: "app-id",
      APPCONFIG_ENVIRONMENT_ID: "env-id",
      APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-id",
      SANDBOX_PROVIDER: "agentcore",
      BROWSERBASE_API_KEY_REF:
        "/alter/prod/sandbox-service/system/browserbase-api-key",
      BROWSERBASE_PROJECT_ID: "browserbase-project",
    });

    expect(environment).toMatchObject({ sandboxProvider: "agentcore" });
    expect(environment).not.toHaveProperty("e2bApiKeyReference");
  });

  it("rejects an unrecognized SANDBOX_PROVIDER value", () => {
    expect(() =>
      loadSandboxEnvironment({
        ...BASE,
        ALTER_ENV: "prod",
        ALTER_CONFIG_SOURCE: "appconfig",
        APPCONFIG_APPLICATION_ID: "app-id",
        APPCONFIG_ENVIRONMENT_ID: "env-id",
        APPCONFIG_CONFIGURATION_PROFILE_ID: "profile-id",
        SANDBOX_PROVIDER: "modal",
        BROWSERBASE_API_KEY_REF:
          "/alter/prod/sandbox-service/system/browserbase-api-key",
        BROWSERBASE_PROJECT_ID: "browserbase-project",
      }),
    ).toThrow("SANDBOX_PROVIDER must be e2b or agentcore");
  });
});
