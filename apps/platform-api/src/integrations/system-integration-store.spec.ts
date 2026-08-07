import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  SystemIntegrationStore,
  SystemIntegrationStoreNotConfiguredError,
} from "./system-integration-store";

describe("SystemIntegrationStore", () => {
  it("throws a real not-configured error when no pool is set", async () => {
    const store = new SystemIntegrationStore(undefined);
    await expect(store.listActiveConnections()).rejects.toThrow(
      SystemIntegrationStoreNotConfiguredError,
    );
  });

  it("real maps connected-connection rows to camelCase refs", async () => {
    const query = vi.fn(async () => ({
      rows: [
        { tenant_id: "ten_1", workspace_id: "ws_1", id: "conn_1" },
        { tenant_id: "ten_2", workspace_id: "ws_2", id: "conn_2" },
      ],
    }));
    const pool = { query } as unknown as Pool;
    const store = new SystemIntegrationStore(pool);

    const result = await store.listActiveConnections();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'connected'"),
    );
    expect(result).toEqual([
      { tenantId: "ten_1", workspaceId: "ws_1", id: "conn_1" },
      { tenantId: "ten_2", workspaceId: "ws_2", id: "conn_2" },
    ]);
  });
});
