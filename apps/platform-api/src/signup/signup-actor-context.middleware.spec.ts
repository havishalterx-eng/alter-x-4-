import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { IdentityService } from "../identity/identity.service";
import type { RbacRequest } from "../rbac/types";
import { PlatformDb } from "./platform-db";
import { SignupActorContextMiddleware } from "./signup-actor-context.middleware";

function request(cookie?: string): FastifyRequest & RbacRequest {
  return { headers: cookie ? { cookie } : {} } as FastifyRequest & RbacRequest;
}

describe("SignupActorContextMiddleware", () => {
  it("hydrates actor from access session and stored roles", async () => {
    const identity = {
      authenticateAccessToken: vi.fn().mockResolvedValue({
        id: "session",
        userId: "user",
        tenantId: "tenant",
      }),
    } as unknown as IdentityService;
    const db = {
      queryTenant: vi
        .fn()
        .mockResolvedValueOnce([{ role: "owner", workspaceId: null }])
        .mockResolvedValueOnce([{ role: "admin", workspaceId: "workspace" }]),
    } as unknown as PlatformDb;
    const middleware = new SignupActorContextMiddleware(identity, db);
    const req = request("alter_access=token");
    const next = vi.fn();

    await middleware.use(req, {} as FastifyReply, next);
    expect(req.actorContext).toEqual({
      user_id: "user",
      tenant_id: "tenant",
      workspace_id: "workspace",
      roles: ["owner", "admin"],
      permissions: [],
      session_id: "session",
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it("continues without actor for missing or invalid token", async () => {
    const identity = {
      authenticateAccessToken: vi.fn().mockRejectedValue(new Error("invalid")),
    } as unknown as IdentityService;
    const middleware = new SignupActorContextMiddleware(
      identity,
      { queryTenant: vi.fn() } as unknown as PlatformDb,
    );
    const next = vi.fn();
    await middleware.use(request(), {} as FastifyReply, next);
    await middleware.use(request("other=x; alter_access=bad"), {} as FastifyReply, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("hydrates tenant-only actor when no workspace membership exists", async () => {
    const identity = {
      authenticateAccessToken: vi.fn().mockResolvedValue({
        id: "session",
        userId: "user",
        tenantId: "tenant",
      }),
    } as unknown as IdentityService;
    const db = {
      queryTenant: vi
        .fn()
        .mockResolvedValueOnce([{ role: "member", workspaceId: null }])
        .mockResolvedValueOnce([]),
    } as unknown as PlatformDb;
    const req = request("theme=dark; alter_access=token");
    await new SignupActorContextMiddleware(identity, db).use(
      req,
      {} as FastifyReply,
      vi.fn(),
    );
    expect(req.actorContext).toEqual(
      expect.not.objectContaining({ workspace_id: expect.anything() }),
    );
  });
});
