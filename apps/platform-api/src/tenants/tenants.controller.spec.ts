import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import { TenantsController } from "./tenants.controller";
import type { TenantsService } from "./tenants.service";

const actor: ActorContext = {
  user_id: "user",
  tenant_id: "tenant",
  roles: ["owner"],
  permissions: [],
  session_id: "session",
};

describe("TenantsController", () => {
  it("forwards list and get with authenticated actor", async () => {
    const list = vi.fn().mockResolvedValue([{ id: "tenant" }]);
    const get = vi.fn().mockResolvedValue({ id: "tenant" });
    const controller = new TenantsController({ list, get } as unknown as TenantsService);
    await expect(controller.list(actor)).resolves.toEqual([{ id: "tenant" }]);
    await expect(controller.get(actor, "tenant")).resolves.toEqual({ id: "tenant" });
    expect(get).toHaveBeenCalledWith(actor, "tenant");
  });

  it("rejects missing actor", () => {
    expect(() => new TenantsController({} as TenantsService).list()).toThrow(
      PlatformHttpError,
    );
  });
});
