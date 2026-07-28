import { describe, expect, it } from "vitest";

import { loadSandboxEnvironment } from "./environment";

const BASE = {
  ALTER_ENV: "local",
  ALTER_SERVICE_NAME: "sandbox-service",
  ALTER_REGION: "ap-south-1",
  ALTER_CONFIG_SOURCE: "mock",
};

describe("loadSandboxEnvironment", () => {
  it("allows mock providers only in local non-production mode", () => {
    expect(loadSandboxEnvironment(BASE)).toEqual({
      alterEnvironment: "local",
      region: "ap-south-1",
      grpcBindAddress: "0.0.0.0:50057",
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
      browserbaseApiKeyReference:
        "/alter/prod/sandbox-service/system/browserbase-api-key",
      browserbaseProjectId: "browserbase-project",
    });
    expect(JSON.stringify(environment)).not.toContain("resolved-secret");
  });
});
