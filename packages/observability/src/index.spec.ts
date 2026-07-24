import { describe, expect, it, vi } from "vitest";

import { createMockObservabilityProvider } from "@alterx/shared-clients";

import {
  initObservability,
  type InitializableObservabilityProvider,
} from "./index";

function provider(options: {
  readonly start?: () => Promise<void>;
  readonly shutdown?: () => Promise<void>;
} = {}): InitializableObservabilityProvider {
  return {
    ...createMockObservabilityProvider(),
    start: options.start ?? vi.fn().mockResolvedValue(undefined),
    shutdown: options.shutdown ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("initObservability", () => {
  it("starts provider, checks health, and drains once", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const input = provider({ start, shutdown });

    const handle = await initObservability(input);

    expect(start).toHaveBeenCalledOnce();
    expect(handle.provider).toBe(input);
    expect(handle.initialHealth).toMatchObject({ status: "healthy" });
    await Promise.all([handle.shutdown(), handle.shutdown()]);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("allows startup health probing to be deferred", async () => {
    const input = provider();
    const healthCheck = vi.spyOn(input, "healthCheck");

    const handle = await initObservability(input, {
      checkHealthOnStart: false,
    });

    expect(handle.initialHealth).toBeUndefined();
    expect(healthCheck).not.toHaveBeenCalled();
  });

  it("fails startup loudly when provider registration fails", async () => {
    const failure = new Error("OTel registration failed");
    const input = provider({
      start: vi.fn().mockRejectedValue(failure),
    });

    await expect(initObservability(input)).rejects.toBe(failure);
  });
});
