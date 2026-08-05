import { describe, expect, it } from "vitest";
import {
  SystemNotificationStore,
  SystemNotificationStoreNotConfiguredError,
} from "./system-notification-store";

describe("SystemNotificationStore", () => {
  it("fails closed with a real, disclosed error when no bypass-RLS pool is configured", async () => {
    const store = new SystemNotificationStore(undefined);
    await expect(
      store.listUsersDueForDigest(new Date(), new Date()),
    ).rejects.toThrow(SystemNotificationStoreNotConfiguredError);
  });

  it("maps real query rows to DigestEligibleUser", async () => {
    const pool = {
      query: async () => ({
        rows: [
          { tenant_id: "tenant-a", user_id: "user-a" },
          { tenant_id: "tenant-b", user_id: "user-b" },
        ],
      }),
    };
    const store = new SystemNotificationStore(pool as never);
    const result = await store.listUsersDueForDigest(new Date(), new Date());
    expect(result).toEqual([
      { tenantId: "tenant-a", userId: "user-a" },
      { tenantId: "tenant-b", userId: "user-b" },
    ]);
  });
});
