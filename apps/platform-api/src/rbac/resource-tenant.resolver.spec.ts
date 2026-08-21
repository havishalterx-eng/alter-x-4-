import { describe, expect, it, vi } from "vitest";
import { WorkspaceResourceTenantResolver } from "./resource-tenant.resolver";
import type { RbacRequest } from "./types";

const TENANT_A = "ten_a";
const TENANT_B = "ten_b";
const WORKSPACE_ID = "ws_1";

function db(resolvedTenantId: string | undefined) {
  const queryWorkspaceTenant = vi.fn(async () => resolvedTenantId);
  return { db: { queryWorkspaceTenant }, queryWorkspaceTenant };
}

describe("WorkspaceResourceTenantResolver", () => {
  it("resolves a direct tenantId route param without a lookup", async () => {
    const { db: harness, queryWorkspaceTenant } = db(undefined);
    const resolver = new WorkspaceResourceTenantResolver(harness);
    const request: RbacRequest = { params: { tenantId: "ten_a" } };

    await expect(resolver.resolveTenantId(request)).resolves.toBe("ten_a");
    expect(queryWorkspaceTenant).not.toHaveBeenCalled();
  });

  it("resolves a direct tenant_id route param without a lookup", async () => {
    const { db: harness, queryWorkspaceTenant } = db(undefined);
    const resolver = new WorkspaceResourceTenantResolver(harness);
    const request: RbacRequest = { params: { tenant_id: "ten_b" } };

    await expect(resolver.resolveTenantId(request)).resolves.toBe("ten_b");
    expect(queryWorkspaceTenant).not.toHaveBeenCalled();
  });

  it("resolves a workspaceId param via a real, actor-tenant-scoped lookup", async () => {
    const { db: harness, queryWorkspaceTenant } = db(TENANT_A);
    const resolver = new WorkspaceResourceTenantResolver(harness);
    const request: RbacRequest = {
      params: { workspaceId: WORKSPACE_ID },
      actorContext: {
        user_id: "usr_1",
        tenant_id: TENANT_A,
        roles: [],
        permissions: [],
        session_id: "sess_1",
      },
    };

    await expect(resolver.resolveTenantId(request)).resolves.toBe(TENANT_A);
    expect(queryWorkspaceTenant).toHaveBeenCalledWith(TENANT_A, WORKSPACE_ID);
  });

  it("resolves workspace_id the same way as workspaceId", async () => {
    const { db: harness } = db(TENANT_A);
    const resolver = new WorkspaceResourceTenantResolver(harness);
    const request: RbacRequest = {
      params: { workspace_id: WORKSPACE_ID },
      actorContext: {
        user_id: "usr_1",
        tenant_id: TENANT_A,
        roles: [],
        permissions: [],
        session_id: "sess_1",
      },
    };

    await expect(resolver.resolveTenantId(request)).resolves.toBe(TENANT_A);
  });

  it("denies instead of skipping when the workspace does not belong to the actor's own tenant", async () => {
    // ENGINE-FIX-P3-21: this is the actual bug fix under test. The old
    // resolver returned undefined here (an empty in-memory map, always),
    // which RbacGuard treats as "nothing to check" -- letting a request
    // through no matter which tenant's workspaceId was in the URL. A real,
    // RLS-scoped lookup under the actor's OWN tenant (TENANT_B here) sees
    // zero rows for a workspace that belongs to TENANT_A, and must return
    // a value that will never equal the actor's tenant_id so RbacGuard's
    // mismatch check actually fires.
    const { db: harness, queryWorkspaceTenant } = db(undefined);
    const resolver = new WorkspaceResourceTenantResolver(harness);
    const request: RbacRequest = {
      params: { workspaceId: WORKSPACE_ID },
      actorContext: {
        user_id: "usr_1",
        tenant_id: TENANT_B,
        roles: [],
        permissions: [],
        session_id: "sess_1",
      },
    };

    const resolved = await resolver.resolveTenantId(request);
    expect(resolved).toBeDefined();
    expect(resolved).not.toBe(TENANT_B);
    expect(queryWorkspaceTenant).toHaveBeenCalledWith(TENANT_B, WORKSPACE_ID);
  });

  it("returns undefined when no tenant or workspace param is present", async () => {
    const { db: harness } = db(undefined);
    const resolver = new WorkspaceResourceTenantResolver(harness);

    await expect(resolver.resolveTenantId({ params: {} })).resolves.toBeUndefined();
    await expect(resolver.resolveTenantId({})).resolves.toBeUndefined();
  });

  it("returns undefined for a workspaceId param with no actor context yet", async () => {
    const { db: harness, queryWorkspaceTenant } = db(TENANT_A);
    const resolver = new WorkspaceResourceTenantResolver(harness);

    await expect(
      resolver.resolveTenantId({ params: { workspaceId: WORKSPACE_ID } }),
    ).resolves.toBeUndefined();
    expect(queryWorkspaceTenant).not.toHaveBeenCalled();
  });
});
