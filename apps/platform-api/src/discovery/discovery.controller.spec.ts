import { describe, expect, it, vi } from "vitest";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryModule } from "./discovery.module";
import { DiscoveryHttpError } from "./problem";

const actor = {
  user_id: "usr_1",
  tenant_id: "tenant_1",
  workspace_id: "workspace_1",
  roles: ["editor"],
  permissions: [],
  session_id: "session_1",
};

describe("DiscoveryController", () => {
  it("delegates tenant-scoped list and mutation actions", async () => {
    const discovery = {
      list: vi.fn().mockResolvedValue([]),
      accept: vi.fn().mockResolvedValue({ id: "rec_1", status: "accepted" }),
      dismiss: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new DiscoveryController(discovery as never);

    await expect(controller.list(actor, undefined)).resolves.toEqual([]);
    await expect(controller.accept("rec_1", actor, undefined, "idem-1")).resolves.toMatchObject({ status: "accepted" });
    await expect(controller.dismiss("rec_1", actor)).resolves.toBeUndefined();
    expect(discovery.list).toHaveBeenCalledWith(actor, undefined);
    expect(discovery.accept).toHaveBeenCalledWith("rec_1", actor, undefined, "idem-1");
    expect(discovery.dismiss).toHaveBeenCalledWith("rec_1", actor);
  });

  it("rejects unauthenticated actors", () => {
    const controller = new DiscoveryController({} as never);
    try {
      controller.list(undefined, undefined);
      throw new Error("expected authentication failure");
    } catch (error) {
      expect(error).toBeInstanceOf(DiscoveryHttpError);
      expect((error as DiscoveryHttpError).getResponse()).toMatchObject({
        status: 401,
        error_code: "AUTHENTICATION_REQUIRED",
      });
    }
  });

  it("registers as a Nest module", () => {
    expect(new DiscoveryModule()).toBeInstanceOf(DiscoveryModule);
  });
});
