import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../rbac/types";
import { PlatformDb } from "../signup/platform-db";
import { MembersService } from "./members.service";

const owner: ActorContext = {
  user_id: "owner",
  tenant_id: "tenant",
  roles: ["owner"],
  permissions: [],
  session_id: "session",
};

describe("MembersService RBAC", () => {
  it("allows owner to invite and blocks member role", async () => {
    const queryTenant = vi.fn().mockResolvedValue([
      {
        id: "membership",
        tenantId: "tenant",
        workspaceId: null,
        userId: "new-user",
        role: "member",
        scope: "tenant",
      },
    ]);
    const service = new MembersService({ queryTenant } as unknown as PlatformDb);
    await expect(
      service.invite(owner, { userId: "new-user", role: "member" }),
    ).resolves.toMatchObject({ userId: "new-user" });
    await expect(
      service.invite(
        { ...owner, roles: ["member"] },
        { userId: "other", role: "member" },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(queryTenant).toHaveBeenCalledOnce();
  });

  it("lists tenant and workspace members", async () => {
    const queryTenant = vi
      .fn()
      .mockResolvedValueOnce([{ id: "tenant-member" }])
      .mockResolvedValueOnce([{ id: "workspace-member" }]);
    const service = new MembersService({ queryTenant } as unknown as PlatformDb);
    await expect(service.list(owner)).resolves.toEqual([
      { id: "tenant-member" },
      { id: "workspace-member" },
    ]);
  });

  it("invites workspace member and validates input", async () => {
    const queryTenant = vi.fn().mockResolvedValue([
      {
        id: "membership",
        tenantId: "tenant",
        workspaceId: "workspace",
        userId: "new-user",
        role: "viewer",
        scope: "workspace",
      },
    ]);
    const service = new MembersService({ queryTenant } as unknown as PlatformDb);
    await expect(
      service.invite(owner, {
        userId: "new-user",
        role: "viewer",
        workspaceId: "workspace",
      }),
    ).resolves.toMatchObject({ scope: "workspace" });
    await expect(service.invite(owner, { userId: "", role: "" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("removes membership for owner and blocks member", async () => {
    const queryTenant = vi.fn().mockResolvedValue([]);
    const service = new MembersService({ queryTenant } as unknown as PlatformDb);
    await expect(service.remove(owner, "member", "workspace")).resolves.toBeUndefined();
    await expect(
      service.remove({ ...owner, roles: ["member"] }, "member", "tenant"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("fails when insert returns no membership", async () => {
    const service = new MembersService({
      queryTenant: vi.fn().mockResolvedValue([]),
    } as unknown as PlatformDb);
    await expect(
      service.invite(owner, { userId: "new-user", role: "member" }),
    ).rejects.toThrow("Member insert returned no row");
  });
});
