import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../../session-store";
import { GoogleIdentityProvider } from "./google-identity-provider";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function provider(fetchImpl: typeof fetch, sessionStore = new InMemorySessionStore()) {
  return new GoogleIdentityProvider(
    {
      clientId: "client-id",
      clientSecretRef: "env:GOOGLE_CLIENT_SECRET",
      resolveSecret: async () => "resolved-secret",
      fetchImpl,
    },
    sessionStore,
  );
}

function googleFetchStub(profile: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return response({ access_token: "google-access", expires_in: 3600, token_type: "Bearer" });
    }
    if (url.includes("googleapis.com/oauth2/v3/userinfo")) {
      return response(profile);
    }
    return response({}, 404);
  }) as typeof fetch;
}

describe("GoogleIdentityProvider", () => {
  it("builds a real Google authorize URL with PKCE params preserved", async () => {
    const google = provider(googleFetchStub({}));
    const url = await google.loginRedirectUrl({
      redirectUri: "https://app.test/callback",
      state: "state-abc",
      codeChallenge: "challenge-abc",
    });
    const parsed = new URL(url);

    expect(parsed.hostname).toBe("accounts.google.com");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.test/callback");
    expect(parsed.searchParams.get("state")).toBe("state-abc");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toContain("email");
  });

  it("exchanges a code and maps the Google profile to a deterministic identity", async () => {
    const google = provider(
      googleFetchStub({
        sub: "112233445566",
        email: "user@example.com",
        email_verified: true,
        name: "User Example",
      }),
    );

    const identity = await google.handleCallback({
      code: "code",
      redirectUri: "https://app.test/callback",
      codeVerifier: "verifier",
    });

    expect(identity.identityRef).toBe("google|112233445566");
    expect(identity.email).toBe("user@example.com");
    expect(identity.emailVerified).toBe(true);
    expect(identity.displayName).toBe("User Example");
    expect(identity.userId).toBeTruthy();
    expect(identity.tenantId).toBeTruthy();
    expect(identity.userId).not.toBe(identity.tenantId);
  });

  it("maps the same Google account to the same user and tenant id across repeated logins", async () => {
    const google = provider(
      googleFetchStub({ sub: "112233445566", email: "user@example.com", email_verified: true }),
    );

    const first = await google.handleCallback({
      code: "code-1",
      redirectUri: "https://app.test/callback",
      codeVerifier: "verifier",
    });
    const second = await google.handleCallback({
      code: "code-2",
      redirectUri: "https://app.test/callback",
      codeVerifier: "verifier",
    });

    expect(second.userId).toBe(first.userId);
    expect(second.tenantId).toBe(first.tenantId);
  });

  it("refreshes a session by re-fetching the Google profile", async () => {
    const google = provider(
      googleFetchStub({ sub: "998877", email: "refreshed@example.com", email_verified: false }),
    );

    const identity = await google.refreshSession("refresh-token");

    expect(identity.identityRef).toBe("google|998877");
    expect(identity.email).toBe("refreshed@example.com");
    expect(identity.emailVerified).toBe(false);
  });

  it("lists and revokes sessions through the shared, provider-agnostic session store", async () => {
    const sessionStore = new InMemorySessionStore();
    const google = provider(googleFetchStub({}), sessionStore);
    const tenantId = "00000000-0000-7000-8000-000000000001";
    const userId = "00000000-0000-7000-8000-000000000101";
    const session = await sessionStore.create({
      tenantId,
      userId,
      refreshTokenHash: "refresh-a",
      accessTokenHash: "access-a",
    });

    await expect(google.listActiveSessions(tenantId, userId)).resolves.toEqual([
      expect.objectContaining({ id: session.id, tenantId }),
    ]);
    await google.revokeSession(tenantId, userId, session.id);
    await expect(google.listActiveSessions(tenantId, userId)).resolves.toEqual([]);
  });

  it("returns the tenant id unchanged since Google has no Organizations concept", async () => {
    const google = provider(googleFetchStub({}));
    await expect(
      google.getOrCreateOrgForTenant("00000000-0000-7000-8000-000000000001", "Tenant A"),
    ).resolves.toBe("00000000-0000-7000-8000-000000000001");
  });

  it("rejects device authorization since Google login does not use the device flow", async () => {
    const google = provider(googleFetchStub({}));
    await expect(google.startDeviceAuthorization()).rejects.toThrow(
      "Device authorization is not supported by the Google identity provider",
    );
    await expect(google.pollDeviceToken("any-device-code")).resolves.toEqual({
      error: "access_denied",
    });
  });

  it("rejects MFA enrollment and challenge since Google has no equivalent concept", async () => {
    const google = provider(googleFetchStub({}));
    await expect(google.enrollMfa("user-id")).rejects.toThrow(
      "MFA enrollment is not supported by the Google identity provider",
    );
    await expect(google.challengeMfa("user-id", "enrollment-id", "123456")).rejects.toThrow(
      "MFA challenge is not supported by the Google identity provider",
    );
  });

  it("rejects SSO configuration since Google has no Auth0-style connection config", async () => {
    const google = provider(googleFetchStub({}));
    await expect(
      google.configureSso("tenant-id", {
        type: "oidc",
        issuer: "https://idp.test",
        clientId: "client",
      }),
    ).rejects.toThrow("SSO configuration is not supported by the Google identity provider");
  });

  it("fails closed when Google returns a non-2xx response", async () => {
    const google = provider((async () => response({}, 401)) as typeof fetch);
    await expect(
      google.handleCallback({
        code: "code",
        redirectUri: "https://app.test/callback",
        codeVerifier: "verifier",
      }),
    ).rejects.toThrow("Google request failed with status 401");
  });
});
