import { describe, expect, it } from "vitest";
import {
  PlatformJobsConfigurationError,
  loadPlatformJobsEnvironment,
  resolveRuntimeSecret,
} from "./platform-jobs-environment";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PLATFORM_API_INTERNAL_BASE_URL: "http://platform-api.internal",
    NOTIFICATION_DIGEST_SERVICE_TOKEN_REF: "env:NOTIFICATION_DIGEST_TOKEN",
    ...overrides,
  };
}

describe("loadPlatformJobsEnvironment", () => {
  it("validates and returns the documented environment with a real default interval", () => {
    expect(loadPlatformJobsEnvironment(environment())).toEqual({
      platformApiInternalBaseUrl: "http://platform-api.internal",
      notificationDigestServiceTokenRef: "env:NOTIFICATION_DIGEST_TOKEN",
      notificationDigestIntervalMs: 60 * 60 * 1000,
    });
  });

  it("accepts a real custom interval", () => {
    expect(
      loadPlatformJobsEnvironment(
        environment({ NOTIFICATION_DIGEST_INTERVAL_MS: "5000" }),
      ).notificationDigestIntervalMs,
    ).toBe(5000);
  });

  it("throws PlatformJobsConfigurationError for a non-positive interval", () => {
    expect(() =>
      loadPlatformJobsEnvironment(environment({ NOTIFICATION_DIGEST_INTERVAL_MS: "0" })),
    ).toThrow(PlatformJobsConfigurationError);
  });

  it("throws PlatformJobsConfigurationError when a required field is missing", () => {
    expect(() =>
      loadPlatformJobsEnvironment(environment({ PLATFORM_API_INTERNAL_BASE_URL: "" })),
    ).toThrow(PlatformJobsConfigurationError);
  });
});

describe("resolveRuntimeSecret", () => {
  it("resolves an env:-prefixed reference from process.env", async () => {
    process.env.NOTIFICATION_DIGEST_TOKEN = "real-token-value";
    await expect(resolveRuntimeSecret("env:NOTIFICATION_DIGEST_TOKEN")).resolves.toBe(
      "real-token-value",
    );
    delete process.env.NOTIFICATION_DIGEST_TOKEN;
  });

  it("throws when the referenced secret is unavailable", async () => {
    await expect(resolveRuntimeSecret("env:DOES_NOT_EXIST")).rejects.toThrow(
      /unavailable/,
    );
  });
});
