import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDENTITY_PROVIDER } from "../identity/identity.module";
import type { IdentityProvider } from "../identity/identity-provider.interface";
import { CLI_CONFIG_PROVIDER } from "./cli-config";
import { CliModule } from "./cli.module";

describe("CliController", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [CliModule] })
      .overrideProvider(IDENTITY_PROVIDER)
      .useValue(identityProvider())
      .overrideProvider(CLI_CONFIG_PROVIDER)
      .useValue({ getCliPolicy: async () => ({ minimumCliVersion: "2.4.0", deviceFlowRateLimitPerMinute: 2 }) })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => app.close());

  it("maps device authorization and token polling payloads", async () => {
    const authorization = await inject("POST", "/api/v1/cli/device/authorize");
    expect(authorization.statusCode).toBe(201);
    expect(authorization.json()).toMatchObject({ device_code: "device", user_code: "USER" });
    const pending = await inject("POST", "/api/v1/cli/device/token", { device_code: "pending" });
    const token = await inject("POST", "/api/v1/cli/device/token", { device_code: "approved" });
    expect(pending.json()).toEqual({ error: "authorization_pending" });
    expect(token.json()).toMatchObject({ access_token: "access", token_type: "Bearer" });
  });

  it("rate limits unauthenticated device authorization requests", async () => {
    expect((await inject("POST", "/api/v1/cli/device/authorize")).statusCode).toBe(201);
    expect((await inject("POST", "/api/v1/cli/device/authorize")).statusCode).toBe(201);
    expect((await inject("POST", "/api/v1/cli/device/authorize")).statusCode).toBe(429);
  });

  it("reports version skew from the configured minimum", async () => {
    const doctor = await app.getHttpAdapter().getInstance().inject({
      method: "GET", url: "/api/v1/cli/doctor", headers: { "x-alter-cli-version": "2.3.0" },
    });
    expect(doctor.json()).toMatchObject({ minimum_cli_version: "2.4.0", your_cli_version_status: "outdated" });
  });

  function inject(method: "POST", url: string, payload?: Record<string, string>) {
    return app.getHttpAdapter().getInstance().inject({ method, url, ...(payload ? { payload } : {}) });
  }
});

function identityProvider(): Pick<IdentityProvider, "startDeviceAuthorization" | "pollDeviceToken"> {
  return {
    startDeviceAuthorization: async () => ({
      deviceCode: "device", userCode: "USER", verificationUri: "https://auth.test/activate", expiresIn: 600, interval: 5,
    }),
    pollDeviceToken: async (deviceCode) =>
      deviceCode === "pending"
        ? { error: "authorization_pending" }
        : { accessToken: "access", refreshToken: "refresh", expiresIn: 3600, tokenType: "Bearer" },
  };
}
