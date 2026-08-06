import { afterEach, describe, expect, it, vi } from "vitest";
import { findConnector } from "../../connectors";
import {
  createFetchOAuthHttpClient,
  generatePkcePair,
  generateState,
} from "./oauth-http-client";

const github = findConnector("github")!;
const google = findConnector("google")!;
const slack = findConnector("slack")!;
const hubspot = findConnector("hubspot")!;
const linkedin = findConnector("linkedin")!;

describe("PKCE and state generation", () => {
  it("produces url-safe, non-repeating verifier/challenge pairs", () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
    for (const value of [a.verifier, a.challenge]) {
      expect(value).toMatch(/^[A-Za-z0-9\-_]+$/);
    }
  });

  it("produces non-repeating state tokens", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe("createFetchOAuthHttpClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges a code for tokens on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "at",
        refresh_token: "rt",
        token_type: "bearer",
        expires_in: 3600,
        scope: "read:user repo",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    const result = await client.exchangeCode({
      connector: "github",
      definition: github,
      code: "code",
      codeVerifier: null,
      redirectUri: "https://app.alter.ai/cb",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.accessToken).toBe("at");
    expect(result.refreshToken).toBe("rt");
    expect(result.grantedScopes).toBe("read:user repo");
    expect(fetchMock).toHaveBeenCalledWith(
      github.tokenUrl,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when the token endpoint returns a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    const client = createFetchOAuthHttpClient();
    await expect(
      client.exchangeCode({
        connector: "github",
        definition: github,
        code: "bad",
        codeVerifier: null,
        redirectUri: "https://app.alter.ai/cb",
        clientId: "cid",
        clientSecret: "csecret",
      }),
    ).rejects.toThrow(/status 401/);
  });

  it("throws when the token response is missing access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    const client = createFetchOAuthHttpClient();
    await expect(
      client.exchangeCode({
        connector: "github",
        definition: github,
        code: "code",
        codeVerifier: null,
        redirectUri: "https://app.alter.ai/cb",
        clientId: "cid",
        clientSecret: "csecret",
      }),
    ).rejects.toThrow(/did not return access_token/);
  });

  it("passes a PKCE code_verifier through to the token request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    await client.exchangeCode({
      connector: "google",
      definition: google,
      code: "code",
      codeVerifier: "verifier-value",
      redirectUri: "https://app.alter.ai/cb",
      clientId: "cid",
      clientSecret: "csecret",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("code_verifier=verifier-value");
  });

  it("resolves account id from github login and google sub", async () => {
    const client = createFetchOAuthHttpClient();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 42, login: "octocat" }),
      }),
    );
    expect(
      await client.fetchAccountId("github", github.userInfoUrl, "at"),
    ).toBe("42");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sub: "sub-1" }) }),
    );
    expect(
      await client.fetchAccountId("google", google.userInfoUrl, "at"),
    ).toBe("sub-1");
  });

  it("throws when the account lookup returns a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const client = createFetchOAuthHttpClient();
    await expect(
      client.fetchAccountId("github", github.userInfoUrl, "at"),
    ).rejects.toThrow(/status 403/);
  });

  it("throws when the account lookup returns no identifier", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    const client = createFetchOAuthHttpClient();
    await expect(
      client.fetchAccountId("github", github.userInfoUrl, "at"),
    ).rejects.toThrow(/did not return an account identifier/);
  });

  it("revokes github via the app grant DELETE endpoint with basic auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "github",
      definition: github,
      accessToken: "at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/applications/cid/grant",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("revokes google via its revoke endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "google",
      definition: google,
      accessToken: "at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      google.revokeUrl,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("discloses non-remote revoke when github grant delete fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "github",
      definition: github,
      accessToken: "at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toMatch(/status 401/);
  });

  it("discloses non-remote revoke when google's revoke endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "google",
      definition: google,
      accessToken: "at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toMatch(/status 500/);
  });

  it("discloses local-only invalidation for a connector with no revoke endpoint", async () => {
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "google",
      definition: { ...google, revokeUrl: null },
      accessToken: "at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toMatch(/no revoke endpoint/);
  });

  it("exchanges a code for Slack's OIDC token endpoint using the generic shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "slack-at",
        refresh_token: "slack-rt",
        token_type: "Bearer",
        expires_in: 43_200,
        scope: "openid email profile",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    const result = await client.exchangeCode({
      connector: "slack",
      definition: slack,
      code: "code",
      codeVerifier: null,
      redirectUri: "https://app.alter.ai/cb",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.accessToken).toBe("slack-at");
    expect(result.refreshToken).toBe("slack-rt");
    expect(fetchMock).toHaveBeenCalledWith(slack.tokenUrl, expect.objectContaining({ method: "POST" }));
  });

  it("resolves Slack's account id from the OIDC userinfo sub claim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sub: "U012ABCDEF" }) }),
    );
    const client = createFetchOAuthHttpClient();
    expect(await client.fetchAccountId("slack", slack.userInfoUrl, "at")).toBe("U012ABCDEF");
  });

  it("revokes Slack via auth.revoke, reading the JSON ok field rather than trusting HTTP status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, revoked: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "slack",
      definition: slack,
      accessToken: "at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(slack.revokeUrl, expect.objectContaining({ method: "POST" }));
  });

  it("treats Slack's HTTP-200-with-ok:false as a real revoke failure, not a success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false, error: "token_revoked" }) }),
    );
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "slack",
      definition: slack,
      accessToken: "at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toContain("token_revoked");
  });

  it("exchanges a code for HubSpot using the generic shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "hs-at",
        refresh_token: "hs-rt",
        token_type: "bearer",
        expires_in: 1_800,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    const result = await client.exchangeCode({
      connector: "hubspot",
      definition: hubspot,
      code: "code",
      codeVerifier: null,
      redirectUri: "https://app.alter.ai/cb",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.accessToken).toBe("hs-at");
    expect(result.refreshToken).toBe("hs-rt");
  });

  it("resolves HubSpot's account id from hub_id via the token-in-path access-tokens endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hub_id: 998877, user: "a@b.com" }) });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    const accountId = await client.fetchAccountId("hubspot", hubspot.userInfoUrl, "hs-at");
    expect(accountId).toBe("998877");
    expect(fetchMock).toHaveBeenCalledWith(
      `${hubspot.userInfoUrl}hs-at`,
      expect.objectContaining({ headers: expect.not.objectContaining({ authorization: expect.anything() }) }),
    );
  });

  it("throws when HubSpot's access-tokens lookup returns no hub_id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const client = createFetchOAuthHttpClient();
    await expect(
      client.fetchAccountId("hubspot", hubspot.userInfoUrl, "hs-at"),
    ).rejects.toThrow(/did not return an account identifier/);
  });

  it("revokes HubSpot by DELETE-ing the refresh token path, not the access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "hubspot",
      definition: hubspot,
      accessToken: "hs-at",
      refreshToken: "hs-rt",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(`${hubspot.revokeUrl}hs-rt`, expect.objectContaining({ method: "DELETE" }));
  });

  it("throws when HubSpot's access-tokens lookup returns a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const client = createFetchOAuthHttpClient();
    await expect(
      client.fetchAccountId("hubspot", hubspot.userInfoUrl, "hs-at"),
    ).rejects.toThrow(/status 401/);
  });

  it("discloses local-only invalidation if Slack were configured without a revoke endpoint", async () => {
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "slack",
      definition: { ...slack, revokeUrl: null },
      accessToken: "at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toMatch(/no revoke endpoint/);
  });

  it("discloses local-only invalidation if HubSpot were configured without a revoke endpoint", async () => {
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "hubspot",
      definition: { ...hubspot, revokeUrl: null },
      accessToken: "hs-at",
      refreshToken: "hs-rt",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toMatch(/no revoke endpoint/);
  });

  it("discloses non-remote revoke when HubSpot's refresh-token delete fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 403 }));
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "hubspot",
      definition: hubspot,
      accessToken: "hs-at",
      refreshToken: "hs-rt",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toMatch(/status 403/);
  });

  it("refuses to fabricate a HubSpot revoke when no refresh token was stored", async () => {
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "hubspot",
      definition: hubspot,
      accessToken: "hs-at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toMatch(/requires a refresh token/);
  });

  it("exchanges a code for LinkedIn and resolves the account id from the OIDC sub claim", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "li-at", expires_in: 5_184_000, scope: "openid profile email" }),
    }));
    const client = createFetchOAuthHttpClient();
    const result = await client.exchangeCode({
      connector: "linkedin",
      definition: linkedin,
      code: "code",
      codeVerifier: null,
      redirectUri: "https://app.alter.ai/cb",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.accessToken).toBe("li-at");
    expect(result.refreshToken).toBeNull(); // LinkedIn doesn't issue refresh tokens for standard apps

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sub: "abc123" }) }));
    expect(await client.fetchAccountId("linkedin", linkedin.userInfoUrl, "li-at")).toBe("abc123");
  });

  it("discloses local-only invalidation for LinkedIn, which has no revoke endpoint at all", async () => {
    const client = createFetchOAuthHttpClient();
    const result = await client.revoke({
      connector: "linkedin",
      definition: linkedin,
      accessToken: "li-at",
      refreshToken: null,
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.revokedRemotely).toBe(false);
    expect(result.reason).toMatch(/no revoke endpoint/);
  });
});
