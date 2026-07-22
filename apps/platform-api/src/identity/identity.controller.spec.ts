import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityModule } from "./identity.module";

describe("IdentityController", () => {
  let app: NestFastifyApplication;
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(async () => {
    delete process.env.DATABASE_URL;
    process.env.IDENTITY_PROVIDER = "mock";

    const moduleRef = await Test.createTestingModule({
      imports: [IdentityModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    logSpy.mockClear();
    errorSpy.mockClear();
  });

  it("redirects login to Universal Login", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        redirectUri: "https://app.test/callback",
        state: "state",
        codeChallenge: "challenge",
        connection: "google-oauth2",
      },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toContain("mock.identity.local/authorize");
  });

  it("sets secure HttpOnly cookies on callback", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/auth/callback?code=user:00000000-0000-7000-8000-000000000201&redirect_uri=https://app.test/callback&code_verifier=verifier",
    });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
    }
  });

  it("rotates refresh token and rejects reused old token", async () => {
    const callback = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/auth/callback?code=user:00000000-0000-7000-8000-000000000202&redirect_uri=https://app.test/callback&code_verifier=verifier",
    });
    const refreshCookie = callback.cookies.find(
      (cookie) => cookie.name === "alter_refresh",
    );
    expect(refreshCookie?.value).toBeTruthy();

    const refresh = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: refreshCookie?.value },
    });
    expect(refresh.statusCode).toBe(200);

    const reused = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: refreshCookie?.value },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({
      error_code: "INVALID_REFRESH_TOKEN",
      status: 401,
    });
  });

  it("revokes one session without affecting another session", async () => {
    const first = await createSession("00000000-0000-7000-8000-000000000203");
    const second = await createSession("00000000-0000-7000-8000-000000000203");

    const list = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: { cookie: `alter_access=${first.access}` },
    });
    const sessionId = list.json().sessions[0].id;

    const revoke = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: `/api/v1/auth/sessions/${sessionId}`,
      headers: { cookie: `alter_access=${first.access}` },
    });
    expect(revoke.statusCode).toBe(204);

    const firstAfterRevoke = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: { cookie: `alter_access=${first.access}` },
    });
    expect(firstAfterRevoke.statusCode).toBe(401);

    const secondAfterRevoke = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: { cookie: `alter_access=${second.access}` },
    });
    expect(secondAfterRevoke.statusCode).toBe(200);
  });

  it("does not log cookie token values on failures", async () => {
    const token = "super-secret-token-value";
    await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: { cookie: `alter_access=${token}` },
    });

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(token));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining(token));
  });

  it("returns problem details for invalid requests and missing cookies", async () => {
    const cases: Array<{
      method: "GET" | "POST";
      url: string;
      payload?: Record<string, unknown>;
      code: string;
    }> = [
      { method: "POST", url: "/api/v1/auth/login", payload: {}, code: "INVALID_REQUEST_BODY" },
      { method: "GET", url: "/api/v1/auth/callback", code: "INVALID_CALLBACK" },
      { method: "POST", url: "/api/v1/auth/refresh", payload: {}, code: "REFRESH_TOKEN_REQUIRED" },
      { method: "GET", url: "/api/v1/auth/sessions", code: "ACCESS_TOKEN_REQUIRED" },
      {
        method: "POST",
        url: "/api/v1/auth/mfa/challenge",
        payload: {},
        code: "INVALID_REQUEST_BODY",
      },
    ];

    for (const testCase of cases) {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: testCase.method,
        url: testCase.url,
        ...(testCase.payload ? { payload: testCase.payload } : {}),
      });
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json()).toMatchObject({ error_code: testCase.code });
    }
  });

  it("refreshes from cookies and clears cookies on logout", async () => {
    const session = await createSession("00000000-0000-7000-8000-000000000204");
    const refresh = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: `ignored=x; alter_refresh=${session.refresh}` },
      payload: {},
    });
    expect(refresh.statusCode).toBe(200);
    const rotatedAccess = refresh.cookies.find((cookie) => cookie.name === "alter_access")?.value;
    expect(rotatedAccess).toBeTruthy();

    const logout = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: `alter_access=${rotatedAccess}` },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringContaining("Max-Age=0")]),
    );

    const anonymousLogout = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/logout",
    });
    expect(anonymousLogout.statusCode).toBe(204);
  });

  it("handles MFA and restricts SSO configuration to internal calls", async () => {
    const session = await createSession("00000000-0000-7000-8000-000000000205");
    const cookie = { cookie: `alter_access=${session.access}` };
    const enrollment = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/mfa/enroll",
      headers: cookie,
      payload: {},
    });
    expect(enrollment.statusCode).toBe(200);

    const challenge = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/mfa/challenge",
      headers: cookie,
      payload: { enrollmentId: enrollment.json().enrollmentId, otp: "000000" },
    });
    expect(challenge.json()).toMatchObject({ status: "rejected" });

    const forbidden = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/sso/configure",
      payload: {},
    });
    expect(forbidden.statusCode).toBe(403);

    const configured = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/api/v1/auth/sso/configure",
      headers: { "x-alter-internal": "true" },
      payload: {
        tenantId: "00000000-0000-7000-8000-000000000001",
        config: { type: "saml", metadataUrl: "https://idp.test/metadata" },
      },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json().config).toMatchObject({ type: "saml" });
  });

  async function createSession(userId: string): Promise<{ access: string; refresh: string }> {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/v1/auth/callback?code=user:${userId}&redirect_uri=https://app.test/callback&code_verifier=verifier`,
    });

    return {
      access: response.cookies.find((cookie) => cookie.name === "alter_access")?.value ?? "",
      refresh:
        response.cookies.find((cookie) => cookie.name === "alter_refresh")?.value ?? "",
    };
  }
});
