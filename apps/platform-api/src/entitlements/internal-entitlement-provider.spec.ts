import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigProvider } from "./config-provider.interface";
import type { EntitlementRow, EntitlementStore } from "./entitlement-store";
import { InternalEntitlementProvider } from "./internal-entitlement-provider";
import { EMERGENCY_FREE_LIMITS, type EntitlementLimits } from "./types";

const defaults: EntitlementLimits = {
  maxWorkflows: 3,
  maxProjects: 1,
  maxRunsPerDay: 10,
  maxConcurrentRuns: 1,
  maxSandboxMinutesPerMonth: 30,
  maxAdsStorageMb: 500,
  maxIntegrations: 3,
};

function setup(row: EntitlementRow | null, config: ConfigProvider = configProvider()) {
  const store: EntitlementStore = {
    findEffective: vi.fn().mockResolvedValue(row),
    create: vi.fn().mockImplementation(async (tenantId, plan) => ({
      tenantId,
      plan,
      limits: null,
    })),
  };
  return { provider: new InternalEntitlementProvider(store, config), store };
}

function configProvider(): ConfigProvider {
  return {
    getEntitlementDefaults: vi.fn().mockResolvedValue(defaults),
    getAbuseThresholds: vi.fn(),
  };
}

describe("InternalEntitlementProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses free config for a tenant without an entitlement row", async () => {
    const { provider } = setup(null);
    await expect(provider.getEffectiveEntitlement("tenant-1")).resolves.toEqual({
      tenantId: "tenant-1",
      plan: "free",
      limits: defaults,
      source: "config",
    });
  });

  it("merges tenant overrides over plan defaults", async () => {
    const { provider } = setup({
      tenantId: "tenant-1",
      plan: "free",
      limits: { maxWorkflows: 20, maxAdsStorageMb: 2_000 },
    });
    const result = await provider.getEffectiveEntitlement("tenant-1");
    expect(result.source).toBe("tenant-override");
    expect(result.limits).toEqual({
      ...defaults,
      maxWorkflows: 20,
      maxAdsStorageMb: 2_000,
    });
  });

  it("logs loudly and uses finite emergency floor when config is down", async () => {
    const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const config = configProvider();
    vi.mocked(config.getEntitlementDefaults).mockRejectedValue(new Error("down"));
    const { provider } = setup(null, config);

    const result = await provider.getEffectiveEntitlement("tenant-1");
    expect(result.limits).toEqual(EMERGENCY_FREE_LIMITS);
    expect(result.source).toBe("emergency-fallback");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("applying emergency free-tier floor"),
      expect.stringContaining("down"),
    );
  });

  it.each([
    [9, true, "LIMIT_AVAILABLE", 1],
    [10, false, "LIMIT_REACHED", 0],
    [11, false, "LIMIT_EXCEEDED", 0],
  ] as const)(
    "checks usage %s against boundary",
    async (usage, allowed, reason, remaining) => {
      const { provider } = setup(null);
      await expect(provider.checkLimit("tenant-1", "maxRunsPerDay", usage)).resolves.toMatchObject({
        allowed,
        reason,
        remaining,
        limit: 10,
      });
    },
  );

  it("creates entitlement then resolves plan defaults", async () => {
    const { provider, store } = setup(null);
    const result = await provider.createEntitlement("tenant-1", "free");
    expect(store.create).toHaveBeenCalledWith("tenant-1", "free");
    expect(result.limits).toEqual(defaults);
  });

  it("rejects invalid usage", async () => {
    const { provider } = setup(null);
    await expect(
      provider.checkLimit("tenant-1", "maxRunsPerDay", -1),
    ).rejects.toThrow("currentUsage must be a non-negative number");
  });
});
