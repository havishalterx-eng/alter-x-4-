import { describe, expect, it, vi } from "vitest";
import { tenantRolesMetadataKey } from "../rbac/rbac.metadata";
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

  it("forwards residency reads and owner-only writes with the If-Match header", async () => {
    const getDataResidency = vi.fn().mockResolvedValue({ data_residency: null });
    const setDataResidency = vi.fn().mockResolvedValue({ data_residency: null });
    const controller = new TenantsController({ getDataResidency, setDataResidency } as unknown as TenantsService);
    const body = { data_residency: null };

    await controller.getDataResidency(actor, "tenant");
    await controller.setDataResidency(actor, "tenant", body, '"etag"');

    expect(getDataResidency).toHaveBeenCalledWith(actor, "tenant");
    expect(setDataResidency).toHaveBeenCalledWith(actor, "tenant", body, '"etag"');
    expect(Reflect.getMetadata(tenantRolesMetadataKey, TenantsController)).toEqual(["member"]);
    expect(Reflect.getMetadata(tenantRolesMetadataKey, TenantsController.prototype.setDataResidency)).toEqual([
      "owner",
    ]);
  });

  it("rejects missing actor", () => {
    expect(() => new TenantsController({} as TenantsService).list()).toThrow(
      PlatformHttpError,
    );
  });
});
