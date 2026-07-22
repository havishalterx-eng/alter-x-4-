import { describe, expect, it } from "vitest";
import { Auth0IdentityProvider } from "./adapters/auth0/auth0-identity-provider";
import { MockIdentityProvider } from "./adapters/mock/mock-identity-provider";
import type { IdentityProvider } from "./identity-provider.interface";

function auth0FetchStub(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = input.toString();
    if (url.includes("/api/v2/organizations?")) {
      return json({ organizations: [] });
    }
    if (url.endsWith("/api/v2/organizations")) {
      return json({ id: "org_test" });
    }
    if (url.endsWith("/oauth/token")) {
      return json({ access_token: "auth0-access" });
    }
    if (url.endsWith("/userinfo")) {
      return json({
        sub: "auth0|123",
        email: "user@example.com",
        name: "User Example",
        org_id: "00000000-0000-7000-8000-000000000001",
        "https://alter.dev/user_id": "00000000-0000-7000-8000-000000000101",
        "https://alter.dev/tenant_id": "00000000-0000-7000-8000-000000000001",
      });
    }
    if (url.endsWith("/api/v2/guardian/enrollments/ticket")) {
      return json({ ticket_id: "ticket_123", ticket_url: "otpauth://example" });
    }
    if (url.endsWith("/mfa/challenge")) {
      return json({ id: "challenge_123", status: "pending" });
    }
    if (url.includes("/api/v2/organizations/")) {
      return json({});
    }

    return json({}, 404);
  }) as typeof fetch;
}

const providers: Array<[string, IdentityProvider]> = [
  ["mock", new MockIdentityProvider()],
  [
    "auth0",
    new Auth0IdentityProvider({
      domain: "tenant.auth0.test",
      clientId: "client-id",
      managementToken: "test-management-token",
      fetchImpl: auth0FetchStub(),
    }),
  ],
];

describe.each(providers)("IdentityProvider contract: %s", (_name, provider) => {
  it("creates orgs, redirects, handles callback, MFA, SSO", async () => {
    const orgId = await provider.getOrCreateOrgForTenant(
      "00000000-0000-7000-8000-000000000001",
      "Tenant A",
    );
    expect(orgId).toBeTruthy();

    const redirectUrl = await provider.loginRedirectUrl({
      redirectUri: "https://app.test/callback",
      state: "state",
      codeChallenge: "challenge",
      organizationId: orgId,
      connection: "google-oauth2",
    });
    expect(redirectUrl).toContain("response_type=code");
    expect(redirectUrl).toContain("code_challenge=challenge");

    const identity = await provider.handleCallback({
      code: "code",
      redirectUri: "https://app.test/callback",
      codeVerifier: "verifier",
    });
    expect(identity.email).toContain("@");
    expect(identity.tenantId).toBeTruthy();
    expect(identity.userId).toBeTruthy();

    const enrollment = await provider.enrollMfa(identity.userId);
    expect(enrollment.enrollmentId).toBeTruthy();

    const challenge = await provider.challengeMfa(
      identity.userId,
      enrollment.enrollmentId,
      "123456",
    );
    expect(["pending", "verified", "rejected"]).toContain(challenge.status);

    await expect(
      provider.configureSso(identity.tenantId, {
        type: "oidc",
        issuer: "https://idp.test",
        clientId: "client",
        clientSecretRef: "secret/ref",
      }),
    ).resolves.toMatchObject({ type: "oidc" });
  });
});

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
