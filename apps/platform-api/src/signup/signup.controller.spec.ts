import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { SignupController } from "./signup.controller";
import type { SignupService } from "./signup.service";

function landing(returning: boolean) {
  return {
    returning,
    userId: "user",
    tenantId: "tenant",
    workspaceId: "workspace",
    tenantRole: "owner",
    workspaceRole: "admin",
    onboardingStatus: "not_started" as const,
    entitlement: { tenantId: "tenant", plan: "free", limits: {}, source: "config" as const },
    actorToken: { token: "actor", claims: {} as never },
    session: {
      sessionId: "session",
      userId: "user",
      tenantId: "tenant",
      accessToken: "access",
      refreshToken: "refresh",
      accessMaxAgeSeconds: 900,
      refreshMaxAgeSeconds: 2_592_000,
    },
  };
}

function reply() {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const header = vi.fn();
  return { value: { header, status } as unknown as FastifyReply, header, status, send };
}

describe("SignupController", () => {
  it.each([
    {},
    { code: "code" },
    { code: "code", redirectUri: "https://app.test/callback" },
  ])("rejects incomplete signup body %#", async (body) => {
    const controller = new SignupController({} as SignupService);
    await expect(
      controller.signup(body, "key", {} as FastifyRequest, {} as FastifyReply),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    { returning: false, idempotencyKey: "key", expectedStatus: 201 },
    { returning: true, idempotencyKey: undefined, expectedStatus: 200 },
  ])("returns landing and secure cookies %#", async (testCase) => {
    const signup = vi.fn().mockResolvedValue(landing(testCase.returning));
    const controller = new SignupController({ signup } as unknown as SignupService);
    const response = reply();
    await controller.signup(
      {
        code: "code",
        redirectUri: "https://app.test/callback",
        codeVerifier: "verifier",
      },
      testCase.idempotencyKey,
      { headers: { "user-agent": "test-agent" }, ip: "127.0.0.1" } as FastifyRequest,
      response.value,
    );

    expect(signup).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: testCase.idempotencyKey ?? "",
        deviceInfo: { userAgent: "test-agent" },
        ip: "127.0.0.1",
      }),
    );
    expect(response.header).toHaveBeenCalledWith("Set-Cookie", [
      expect.stringContaining("alter_access=access; Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Lax"),
      expect.stringContaining("alter_refresh=refresh; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax"),
    ]);
    expect(response.status).toHaveBeenCalledWith(testCase.expectedStatus);
    expect(response.send).toHaveBeenCalledWith(
      expect.not.objectContaining({ session: expect.anything() }),
    );
  });
});
