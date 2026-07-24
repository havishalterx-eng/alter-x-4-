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
        REDIS_ENDPOINT_PARAM: "/alter/dev/platform-api/redis-endpoint",
      }),
    ).toEqual({
      DATABASE_URL: "postgres://platform_api:platform_api_local@localhost:5432/platform_db",
      REDIS_ENDPOINT_PARAM: "/alter/dev/platform-api/redis-endpoint",
    });
  });
});
