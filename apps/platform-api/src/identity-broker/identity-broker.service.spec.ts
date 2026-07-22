import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineHealthTransport } from "./engine-health.client";
import { EngineHealthClient } from "./engine-health.client";
import { IdentityBrokerError } from "./identity-broker.error";
import { IdentityBrokerService, serviceUserId } from "./identity-broker.service";
import { decodeActorToken, verifyActorToken } from "./jwt";
import { StaticSigningKeyResolver } from "./signing-key-resolver";

const tenantId = "00000000-0000-7000-8000-000000000001";
const workspaceId = "00000000-0000-7000-8000-000000000101";
const userId = "00000000-0000-7000-8000-000000000201";
const sessionId = "00000000-0000-7000-8000-000000000301";
const signingKeyRef = "test/actor-token-signing-key";

describe("IdentityBrokerService", () => {
  let service: IdentityBrokerService;
  let publicKey: string;
  let privateKey: string;
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    const generated = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    service = new IdentityBrokerService(
      signingKeyRef,
      new StaticSigningKeyResolver(privateKey, publicKey),
      () => 1_785_000_000,
    );
    logSpy.mockClear();
    errorSpy.mockClear();
  });

  it("mints human actor token with exact claim shape", async () => {
    const minted = await service.mintActorToken({
      userId,
      tenantId,
      workspaceId,
      sessionId,
      authTime: 1_784_999_900,
      roles: ["owner"],
      permissions: ["workflow:read"],
      callingTenantId: tenantId,
    });
    const decoded = decodeActorToken(minted.token);

    expect(Object.keys(decoded).sort()).toEqual(
      [
        "aud",
        "auth_time",
        "exp",
        "iat",
        "iss",
        "jti",
        "permissions",
        "roles",
        "session_id",
        "tenant_id",
        "user_id",
        "workspace_id",
      ].sort(),
    );
    expect(decoded).toMatchObject({
      user_id: userId,
      tenant_id: tenantId,
      workspace_id: workspaceId,
      roles: ["owner"],
      permissions: ["workflow:read"],
      session_id: sessionId,
      auth_time: 1_784_999_900,
      iss: "alter-platform-api.identity-broker",
      aud: "alter-engine",
      iat: 1_785_000_000,
      exp: 1_785_000_300,
    });
    expect(verifyActorToken(minted.token, publicKey)).toBe(true);
  });

  it("hard-caps expiry at exactly 300 seconds", async () => {
    const minted = await mintHuman();

    expect(minted.claims.exp - minted.claims.iat).toBe(300);
  });

  it("generates unique jti values", async () => {
    const tokens = await Promise.all(
      Array.from({ length: 1000 }, () => mintHuman()),
    );
    const jtis = new Set(tokens.map((token) => token.claims.jti));

    expect(jtis.size).toBe(1000);
  });

  it("mints service actor token without fabricated human user id", async () => {
    const minted = await service.mintServiceActorToken({
      serviceName: "platform-workers",
      tenantId,
      permissions: ["runs:dispatch"],
      callingTenantId: tenantId,
    });

    expect(minted.claims.user_id).toBe("svc_platform_workers");
    expect(minted.claims.roles).toEqual(["service"]);
    expect(minted.claims.workspace_id).toBe("workspace_system");
    expect(minted.claims.user_id).not.toBe(userId);
  });

  it("rejects tenant scope mismatch at mint time", async () => {
    await expect(
      service.mintActorToken({
        userId,
        tenantId,
        workspaceId,
        sessionId,
        authTime: 1_784_999_900,
        roles: ["owner"],
        permissions: [],
        callingTenantId: "00000000-0000-7000-8000-000000000999",
      }),
    ).rejects.toBeInstanceOf(IdentityBrokerError);
  });

  it("does not log signing key material", async () => {
    await expect(mintHuman()).resolves.toBeTruthy();

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(privateKey));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining(privateKey));
  });

  it("passes minted token to Engine health transport", async () => {
    let actorToken = "";
    const transport: EngineHealthTransport = {
      getHealth: async (headers) => {
        actorToken = headers["X-Alter-Actor-Token"] ?? "";
        return { status: "ok" };
      },
    };
    const client = new EngineHealthClient(service, transport);

    await expect(
      client.getHealthWithActor({
        userId,
        tenantId,
        workspaceId,
        sessionId,
        authTime: 1_784_999_900,
        roles: ["owner"],
        permissions: [],
        callingTenantId: tenantId,
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(verifyActorToken(actorToken, publicKey)).toBe(true);
  });

  async function mintHuman() {
    return service.mintActorToken({
      userId,
      tenantId,
      workspaceId,
      sessionId,
      authTime: 1_784_999_900,
      roles: ["owner"],
      permissions: [],
      callingTenantId: tenantId,
    });
  }
});

describe("service actor naming", () => {
  it("normalizes service actor ids", () => {
    expect(serviceUserId("Platform Workers")).toBe("svc_platform_workers");
  });
});
