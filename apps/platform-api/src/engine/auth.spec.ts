import { describe, expect, it, vi } from "vitest";
import type { IdentityBrokerService } from "../identity-broker/identity-broker.service";
import {
  Auth0EngineM2mTokenProvider,
  IdentityBrokerEngineAuthProvider,
  type EngineM2mTokenProvider,
} from "./auth";
import type { EngineCallerContext } from "./types";

describe("Auth0EngineM2mTokenProvider", () => {
  it("requests a tenant-scoped token and caches it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "engine-m2m",
          expires_in: 300,
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    const resolveSecret = vi.fn().mockResolvedValue("secret-value");
    const provider = new Auth0EngineM2mTokenProvider({
      tokenUrl: "https://identity.test/oauth/token",
      audience: "https://engine.test",
      clientId: "platform-api",
      clientSecretRef: "env:ENGINE_SECRET",
      resolveSecret,
      fetchImpl,
      now: () => 1_000,
    });

    await expect(provider.getAccessToken("tenant-a")).resolves.toBe("engine-m2m");
    await expect(provider.getAccessToken("tenant-a")).resolves.toBe("engine-m2m");

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(resolveSecret).toHaveBeenCalledWith("env:ENGINE_SECRET");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      grant_type: "client_credentials",
      organization: "tenant-a",
      audience: "https://engine.test",
    });
  });

  it("rejects failed and malformed token responses", async () => {
    const options = {
      tokenUrl: "https://identity.test/oauth/token",
      audience: "https://engine.test",
      clientId: "platform-api",
      clientSecretRef: "env:ENGINE_SECRET",
      resolveSecret: vi.fn().mockResolvedValue("secret"),
    };
    await expect(
      new Auth0EngineM2mTokenProvider({
        ...options,
        fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      }).getAccessToken("tenant-a"),
    ).rejects.toThrow("M2M token request failed with status 401");

    await expect(
      new Auth0EngineM2mTokenProvider({
        ...options,
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ token: "wrong" }), { status: 200 }),
        ),
      }).getAccessToken("tenant-a"),
    ).rejects.toThrow("M2M token response failed validation");
  });
});

describe("IdentityBrokerEngineAuthProvider", () => {
  it("mints a caller-scoped actor token and pairs it with tenant M2M auth", async () => {
    const identityBroker = {
      mintActorToken: vi.fn().mockResolvedValue({
        token: "actor-token",
        claims: {},
      }),
    } as unknown as IdentityBrokerService;
    const m2mProvider: EngineM2mTokenProvider = {
      getAccessToken: vi.fn().mockResolvedValue("m2m-token"),
    };
    const provider = new IdentityBrokerEngineAuthProvider(
      identityBroker,
      m2mProvider,
    );
    const context: EngineCallerContext = {
      userId: "user-a",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      sessionId: "session-a",
      authTime: 100,
      roles: ["owner"],
      permissions: ["runs:create"],
      traceparent: "trace",
    };

    await expect(provider.authorize(context)).resolves.toEqual({
      m2mAccessToken: "m2m-token",
      actorToken: "actor-token",
    });
    expect(identityBroker.mintActorToken).toHaveBeenCalledWith({
      userId: "user-a",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      sessionId: "session-a",
      authTime: 100,
      roles: ["owner"],
      permissions: ["runs:create"],
      callingTenantId: "tenant-a",
    });
  });
});
