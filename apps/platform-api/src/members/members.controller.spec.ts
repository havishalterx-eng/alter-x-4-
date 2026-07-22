import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import { MembersController } from "./members.controller";
import type { MembersService } from "./members.service";

const actor: ActorContext = {
  user_id: "user",
  tenant_id: "tenant",
  roles: ["owner"],
  permissions: [],
  session_id: "session",
};

describe("MembersController", () => {
  it("forwards list, invite, and removal scopes", async () => {
    const list = vi.fn().mockResolvedValue([{ id: "member" }]);
    const invite = vi.fn().mockResolvedValue({ id: "member" });
    const remove = vi.fn().mockResolvedValue(undefined);
    const controller = new MembersController({ list, invite, remove } as unknown as MembersService);
    await expect(controller.list(actor)).resolves.toEqual([{ id: "member" }]);
    await controller.invite(actor, { userId: "new-user", role: "member" });
    await controller.remove(actor, "member", "workspace");
    await controller.remove(actor, "member");
    expect(remove).toHaveBeenNthCalledWith(1, actor, "member", "workspace");
    expect(remove).toHaveBeenNthCalledWith(2, actor, "member", "tenant");
  });

  it("rejects missing actor", () => {
    expect(() => new MembersController({} as MembersService).list()).toThrow(
      PlatformHttpError,
    );
  });
});
