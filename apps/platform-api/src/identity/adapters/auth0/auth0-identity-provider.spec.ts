import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../../session-store";
import { InMemorySsoConfigStore } from "../../sso-config-store";
import { Auth0IdentityProvider } from "./auth0-identity-provider";

function provider(fetchImpl: typeof fetch, options: Record<string, unknown> = {}) {
  return new Auth0IdentityProvider(
    {
      domain: "tenant.auth0.test",
      clientId: "client-id",
      fetchImpl,
      ...options,
    },
    new InMemorySessionStore(),
    new InMemorySsoConfigStore(),
  );
}

describe("Auth0IdentityProvider edge behavior", () => {
  it("supports refresh and profile claim fallbacks without an interactive secret", async () => {
    const fetchStub = (async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith("/oauth/token")) return response({ access_token: "access" });
      if (url.endsWith("/userinfo")) {
        return response({
          sub: "auth0|fallback",
          email: "fallback@example.com",
          org_id: "org-fallback",
        });
      }
      return response({}, 404);
    }) as typeof fetch;
    const auth0 = provider(fetchStub);

    const redirect = await auth0.loginRedirectUrl({
      redirectUri: "https://app.test/callback",
      state: "state",
      codeChallenge: "challenge",
    });
    expect(redirect).not.toContain("organization=");
    expect(redirect).not.toContain("connection=");
    await expect(
      auth0.refreshSession("refresh-token"),
    ).resolves.toEqual({
      userId: "auth0|fallback",
      tenantId: "org-fallback",
      identityRef: "auth0|fallback",
      email: "fallback@example.com",
      emailVerified: false,
    });
  });

  it("maps rejected MFA challenges", async () => {
    const auth0 = provider(
      (async () => response({ id: "challenge", status: "rejected" })) as typeof fetch,
    );
    await expect(auth0.challengeMfa("user", "mfa", "000000")).resolves.toEqual({
      challengeId: "challenge",
      status: "rejected",
    });
  });

  it("fails closed when management credentials or secret resolution are unavailable", async () => {
    const unusedFetch = (async () => response({})) as typeof fetch;
    await expect(provider(unusedFetch).getOrCreateOrgForTenant("tenant", "Tenant")).rejects.toThrow(
      "management credentials unavailable",
    );
    await expect(
      provider(unusedFetch, {
        m2mClientId: "m2m",
        m2mClientSecretRef: "env:MISSING",
      }).getOrCreateOrgForTenant("tenant", "Tenant"),
    ).rejects.toThrow("secret resolver unavailable");
  });

  it("surfaces unsuccessful Auth0 HTTP responses", async () => {
    const auth0 = provider((async () => response({}, 503)) as typeof fetch);
    await expect(
      auth0.handleCallback({ code: "code", redirectUri: "uri", codeVerifier: "verifier" }),
    ).rejects.toThrow("Auth0 request failed with status 503");
  });
});

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
