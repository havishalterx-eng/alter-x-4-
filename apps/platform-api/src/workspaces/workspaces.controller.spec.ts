import type { FastifyReply } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import { WorkspacesController } from "./workspaces.controller";
import type { WorkspacesService } from "./workspaces.service";

const actor: ActorContext = {
  user_id: "user",
  tenant_id: "tenant",
  roles: ["owner"],
  permissions: [],
  session_id: "session",
};
const workspace = {
  id: "workspace",
  tenantId: "tenant",
  name: "Default",
  status: "active",
  updatedAt: new Date("2026-07-23T00:00:00.000Z"),
};

function reply() {
  const send = vi.fn();
  const header = vi.fn(() => ({ send }));
  return { value: { header } as unknown as FastifyReply, header, send };
}

describe("WorkspacesController", () => {
  it("forwards list and create including default name", async () => {
    const list = vi.fn().mockResolvedValue([workspace]);
    const create = vi.fn().mockResolvedValue(workspace);
    const controller = new WorkspacesController({ list, create } as unknown as WorkspacesService);
    await expect(controller.list(actor)).resolves.toEqual([workspace]);
    await controller.create(actor, { name: "New" });
    await controller.create(actor, {});
    expect(create).toHaveBeenNthCalledWith(1, actor, "New");
    expect(create).toHaveBeenNthCalledWith(2, actor, "");
  });

  it("writes ETags for get and update", async () => {
    const get = vi.fn().mockResolvedValue(workspace);
    const update = vi.fn().mockResolvedValue({ ...workspace, name: "Renamed" });
    const controller = new WorkspacesController({ get, update } as unknown as WorkspacesService);
    const getReply = reply();
    await controller.get(actor, "workspace", getReply.value);
    expect(getReply.header).toHaveBeenCalledWith("ETag", expect.stringMatching(/^".+"$/));
    expect(getReply.send).toHaveBeenCalledWith(workspace);

    const updateReply = reply();
    await controller.update(actor, "workspace", '"etag"', {}, updateReply.value);
    expect(update).toHaveBeenCalledWith(actor, "workspace", "", '"etag"');
    expect(updateReply.send).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed" }));
  });

  it("rejects missing actor", () => {
    expect(() => new WorkspacesController({} as WorkspacesService).list()).toThrow(
      PlatformHttpError,
    );
  });
});
