import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityModule, resolveRuntimeSecret } from "./identity.module";
import { IdentityService } from "./identity.service";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("IdentityModule", () => {
  it("resolves env-prefixed and direct secret references", async () => {
    process.env.TEST_AUTH_SECRET = "secret-value";
    await expect(resolveRuntimeSecret("env:TEST_AUTH_SECRET")).resolves.toBe("secret-value");
    await expect(resolveRuntimeSecret("TEST_AUTH_SECRET")).resolves.toBe("secret-value");
    await expect(resolveRuntimeSecret("env:MISSING_AUTH_SECRET")).rejects.toThrow(
      "Secret reference unavailable",
    );
  });

  it("builds the in-memory mock provider without database configuration", async () => {
    delete process.env.DATABASE_URL;
    process.env.IDENTITY_PROVIDER = "mock";
    const moduleRef = await Test.createTestingModule({ imports: [IdentityModule] }).compile();
    expect(moduleRef.get(IdentityService)).toBeInstanceOf(IdentityService);
    await moduleRef.close();
  });

  it("builds Auth0 and PostgreSQL-backed stores from runtime configuration", async () => {
    process.env.DATABASE_URL = "postgres://local.invalid/platform";
    process.env.IDENTITY_PROVIDER = "auth0";
    process.env.AUTH0_DOMAIN = "tenant.auth0.test";
    process.env.AUTH0_CLIENT_ID = "client-id";
    process.env.AUTH0_CLIENT_SECRET_REF = "env:AUTH0_CLIENT_SECRET";
    process.env.AUTH0_M2M_CLIENT_ID = "m2m-client";
    process.env.AUTH0_M2M_CLIENT_SECRET_REF = "env:AUTH0_M2M_CLIENT_SECRET";
    const moduleRef = await Test.createTestingModule({ imports: [IdentityModule] }).compile();
    expect(moduleRef.get(IdentityService)).toBeInstanceOf(IdentityService);
    await moduleRef.close();
  });
});
