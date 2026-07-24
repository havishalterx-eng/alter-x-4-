import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../rbac/types";
import { PlatformDb } from "../signup/platform-db";
import { TenantsService } from "./tenants.service";

const actor: ActorContext = {
  user_id: "user",
  tenant_id: "tenant",
  roles: ["owner"],
  permissions: [],
  session_id: "session",
};
const tenant = {
  id: "tenant",
  name: "User's Workspace",
  status: "active",
  region: "ap-south-1",
  role: "owner",
};

describe("TenantsService", () => {
  it("lists and reads caller tenant", async () => {
    const queryTenant = vi.fn().mockResolvedValue([tenant]);
    const service = new TenantsService({ queryTenant } as unknown as PlatformDb);
    await expect(service.list(actor)).resolves.toEqual([tenant]);
    await expect(service.get(actor, "tenant")).resolves.toEqual(tenant);
  });

  it("returns RFC problem for missing tenant", async () => {
    const service = new TenantsService({
      queryTenant: vi.fn().mockResolvedValue([]),
    } as unknown as PlatformDb);
    await expect(service.get(actor, "missing")).rejects.toMatchObject({ status: 404 });
  });
});
