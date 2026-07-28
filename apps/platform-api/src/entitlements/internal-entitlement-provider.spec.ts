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
const limited: EntitlementLimits = {
  maxWorkflows: 1,
  maxProjects: 0,
  maxRunsPerDay: 2,
  maxConcurrentRuns: 1,
  maxSandboxMinutesPerMonth: 5,
  maxAdsStorageMb: 100,
  maxIntegrations: 0,
};

function setup(row: EntitlementRow | null, config: ConfigProvider = configProvider()) {
  const store: EntitlementStore = {
    findEffective: vi.fn().mockResolvedValue(row),
    create: vi.fn().mockImplementation(async (tenantId, plan) => ({
      tenantId,
      plan,
      limits: null,
      accessState: "active",
    })),
  };
  return { provider: new InternalEntitlementProvider(store, config), store };
}

function configProvider(): ConfigProvider {
  return {
    getEntitlementDefaults: vi.fn().mockResolvedValue(defaults),
    getAbuseThresholds: vi.fn(),
    getDunningConfig: vi.fn().mockResolvedValue({
      gracePeriodSeconds: 60,
      suspensionThresholdSeconds: 120,
      limitedStateLimits: limited,
    }),
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
      accessState: "active",
      source: "config",
    });
  });

  it("merges tenant overrides over plan defaults", async () => {
    const { provider } = setup({
      tenantId: "tenant-1",
      plan: "free",
      limits: { maxWorkflows: 20, maxAdsStorageMb: 2_000 },
      accessState: "active",
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

  it("resolves limited and suspended limits from dunning config", async () => {
    const limitedSetup = setup({
      tenantId: "tenant-1",
      plan: "pro",
      limits: null,
      accessState: "limited",
    });
    await expect(
      limitedSetup.provider.getEffectiveEntitlement("tenant-1"),
    ).resolves.toMatchObject({
      limits: limited,
      accessState: "limited",
      source: "dunning",
    });

    const suspendedSetup = setup({
      tenantId: "tenant-1",
      plan: "pro",
      limits: null,
      accessState: "suspended",
    });
    await expect(
      suspendedSetup.provider.getEffectiveEntitlement("tenant-1"),
    ).resolves.toMatchObject({
      limits: Object.fromEntries(
        Object.keys(limited).map((key) => [key, 0]),
      ),
      accessState: "suspended",
      source: "dunning",
    });
  });

  it("applies changed dunning config to an already-limited tenant", async () => {
    const config = configProvider();
    const changed = { ...limited, maxRunsPerDay: 1 };
    vi.mocked(config.getDunningConfig)
      .mockResolvedValueOnce({
        gracePeriodSeconds: 60,
        suspensionThresholdSeconds: 120,
        limitedStateLimits: limited,
      })
      .mockResolvedValueOnce({
        gracePeriodSeconds: 60,
        suspensionThresholdSeconds: 120,
        limitedStateLimits: changed,
      });
    const { provider } = setup(
      {
        tenantId: "tenant-1",
        plan: "pro",
        limits: null,
        accessState: "limited",
      },
      config,
    );

    await expect(provider.getEffectiveEntitlement("tenant-1")).resolves.toMatchObject({
      limits: limited,
      source: "dunning",
    });
    await expect(provider.getEffectiveEntitlement("tenant-1")).resolves.toMatchObject({
      limits: changed,
      source: "dunning",
    });
  });

  it("rejects partial dunning limits instead of leaking paid defaults", async () => {
    const config = configProvider();
    vi.mocked(config.getDunningConfig).mockResolvedValue({
      gracePeriodSeconds: 60,
      suspensionThresholdSeconds: 120,
      limitedStateLimits: {
        maxRunsPerDay: 2,
      } as EntitlementLimits,
    });
    const { provider } = setup(
      {
        tenantId: "tenant-1",
        plan: "pro",
        limits: null,
        accessState: "limited",
      },
      config,
    );

    await expect(
      provider.getEffectiveEntitlement("tenant-1"),
    ).rejects.toThrow(
      "dunning.limitedStateLimits.maxWorkflows must be a non-negative number",
    );
  });

  it("recovery to active ignores prior dunning limits and restores plan defaults", async () => {
    const { provider } = setup({
      tenantId: "tenant-1",
      plan: "pro",
      limits: null,
      accessState: "active",
    });

    await expect(provider.getEffectiveEntitlement("tenant-1")).resolves.toEqual({
      tenantId: "tenant-1",
      plan: "pro",
      limits: defaults,
      accessState: "active",
      source: "config",
    });
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
    expect(store.create).toHaveBeenCalledWith(
      "tenant-1",
      "free",
      undefined,
      undefined,
    );
    expect(result.limits).toEqual(defaults);
  });

  it("rejects invalid usage", async () => {
    const { provider } = setup(null);
    await expect(
      provider.checkLimit("tenant-1", "maxRunsPerDay", -1),
    ).rejects.toThrow("currentUsage must be a non-negative number");
  });
});
