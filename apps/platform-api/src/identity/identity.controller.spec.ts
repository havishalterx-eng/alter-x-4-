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
