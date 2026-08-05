import { describe, expect, it } from "vitest";
import type { DeviceTokenResult, IdentityProvider } from "../identity/identity-provider.interface";
import { CliService, cliVersionStatus } from "./cli.service";

const policy = {
  getCliPolicy: async () => ({ minimumCliVersion: "2.4.0", deviceFlowRateLimitPerMinute: 3 }),
};

describe("CliService", () => {
  it("returns real polling states without converting them into tokens", async () => {
    const states: DeviceTokenResult[] = [
      { error: "authorization_pending" },
      { error: "slow_down" },
      { error: "expired_token" },
      { error: "access_denied" },
      { accessToken: "access", refreshToken: "refresh", expiresIn: 3600, tokenType: "Bearer" },
    ];
    const service = new CliService(
      {
        startDeviceAuthorization: async () => ({
          deviceCode: "device", userCode: "USER", verificationUri: "https://auth.test/activate", expiresIn: 600, interval: 5,
        }),
        pollDeviceToken: async () => states.shift()!,
      } as unknown as IdentityProvider,
      policy,
    );

    await expect(service.poll("device")).resolves.toEqual({ error: "authorization_pending" });
    await expect(service.poll("device")).resolves.toEqual({ error: "slow_down" });
    await expect(service.poll("device")).resolves.toEqual({ error: "expired_token" });
    await expect(service.poll("device")).resolves.toEqual({ error: "access_denied" });
    await expect(service.poll("device")).resolves.toEqual({
      accessToken: "access", refreshToken: "refresh", expiresIn: 3600, tokenType: "Bearer",
    });
  });

  it("reports current, outdated, and unsupported CLI versions", async () => {
    expect(cliVersionStatus("2.4.0", "2.4.0")).toBe("current");
    expect(cliVersionStatus("2.5.0", "2.4.0")).toBe("current");
    expect(cliVersionStatus("2.3.9", "2.4.0")).toBe("outdated");
    expect(cliVersionStatus("1.99.99", "2.4.0")).toBe("unsupported");
    expect(cliVersionStatus(undefined, "2.4.0")).toBe("unsupported");
  });
});
