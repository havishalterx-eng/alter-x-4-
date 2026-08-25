import { describe, expect, it, vi } from "vitest";

import { AuditStoreLifecycle } from "./store.lifecycle";

describe("AuditStoreLifecycle", () => {
  it("closes the underlying store on application shutdown", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const lifecycle = new AuditStoreLifecycle({ close } as never);
    await lifecycle.onApplicationShutdown();
    expect(close).toHaveBeenCalledOnce();
  });
});
