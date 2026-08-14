import { describe, expect, it } from "vitest";
import { RequestParamTenantResolver } from "./resource-tenant.resolver";
import type { RbacRequest } from "./types";

describe("RequestParamTenantResolver", () => {
  it("resolves a direct tenantId route param", async () => {
    const resolver = new RequestParamTenantResolver();
    const request: RbacRequest = { params: { tenantId: "ten_a" } };

    await expect(resolver.resolveTenantId(request)).resolves.toBe("ten_a");
  });

  it("resolves a direct tenant_id route param", async () => {
    const resolver = new RequestParamTenantResolver();
    const request: RbacRequest = { params: { tenant_id: "ten_b" } };

    await expect(resolver.resolveTenantId(request)).resolves.toBe("ten_b");
  });

  it("resolves a workspaceId route param through the configured mapping", async () => {
    const resolver = new RequestParamTenantResolver({ ws_1: "ten_mapped" });
    const request: RbacRequest = { params: { workspaceId: "ws_1" } };

    await expect(resolver.resolveTenantId(request)).resolves.toBe("ten_mapped");
  });

  it("returns undefined for an unmapped workspaceId", async () => {
    const resolver = new RequestParamTenantResolver();
    const request: RbacRequest = { params: { workspace_id: "ws_unknown" } };

    await expect(resolver.resolveTenantId(request)).resolves.toBeUndefined();
  });

  it("returns undefined when no tenant or workspace param is present", async () => {
    const resolver = new RequestParamTenantResolver();

    await expect(resolver.resolveTenantId({ params: {} })).resolves.toBeUndefined();
    await expect(resolver.resolveTenantId({})).resolves.toBeUndefined();
  });
});
