import { describe, expect, it, vi } from "vitest";

import { RunNotFoundError, RunValidationError, type OrchestrationTenantStore } from "./run-launcher.service";
import { RunWorkspaceLookupService } from "./run-workspace-lookup.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const WORKSPACE = "018f4d6e-2b4a-7a3e-8c1a-abcdefabcdef";

function fakeStore(workspaceId: string | undefined): {
  store: OrchestrationTenantStore;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => ({
    rowCount: workspaceId === undefined ? 0 : 1,
    rows: workspaceId === undefined ? [] : [{ workspace_id: workspaceId }],
  }));
  return {
    query,
    store: {
      withTenant: async (tenantId, operation) => {
        expect(tenantId).toBe(BARE_TENANT);
        return operation({ query } as unknown as Parameters<typeof operation>[0]);
      },
    },
  };
}

describe("RunWorkspaceLookupService", () => {
  it("resolves the real workspace_id for a run this tenant owns", async () => {
    const { store, query } = fakeStore(WORKSPACE);
    const service = new RunWorkspaceLookupService(store);

    await expect(service.getWorkspaceId(TENANT, RUN)).resolves.toBe(WORKSPACE);
    expect(query).toHaveBeenCalledWith(
      "SELECT workspace_id FROM runs WHERE tenant_id = $1 AND id = $2",
      [BARE_TENANT, RUN],
    );
  });

  it("raises RunNotFoundError for a run this tenant cannot see", async () => {
    const { store } = fakeStore(undefined);
    const service = new RunWorkspaceLookupService(store);

    await expect(service.getWorkspaceId(TENANT, RUN)).rejects.toThrow(RunNotFoundError);
  });

  it("rejects a malformed tenant_id before touching the store", async () => {
    const { store, query } = fakeStore(WORKSPACE);
    const service = new RunWorkspaceLookupService(store);

    await expect(service.getWorkspaceId("not-a-tenant", RUN)).rejects.toThrow(
      RunValidationError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a malformed run_id before touching the store", async () => {
    const { store, query } = fakeStore(WORKSPACE);
    const service = new RunWorkspaceLookupService(store);

    await expect(service.getWorkspaceId(TENANT, "not-a-run")).rejects.toThrow(
      RunValidationError,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
