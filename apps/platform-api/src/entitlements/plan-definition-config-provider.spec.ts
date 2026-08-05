import { describe, expect, it, vi } from "vitest";
import type { ConfigProvider } from "./config-provider.interface";
import { PlanDefinitionConfigProvider } from "./plan-definition-config-provider";
import type { PlanDefinitionStore } from "./plan-definition-store";
import type { AbuseThresholds, DunningConfig, EntitlementLimits } from "./types";

const BASELINE: EntitlementLimits = {
  maxWorkflows: 3,
  maxProjects: 1,
  maxRunsPerDay: 10,
  maxConcurrentRuns: 1,
  maxSandboxMinutesPerMonth: 30,
  maxAdsStorageMb: 500,
  maxIntegrations: 3,
};

const STAFF_AUTHORED: EntitlementLimits = { ...BASELINE, maxWorkflows: 250 };

const abuse = { tenantRequestsPerMinute: 1 } as unknown as AbuseThresholds;
const dunning = { gracePeriodSeconds: 1 } as unknown as DunningConfig;

function baselineProvider(): ConfigProvider {
  return {
    getEntitlementDefaults: vi.fn(async () => ({ ...BASELINE })),
    getAbuseThresholds: vi.fn(async () => abuse),
    getDunningConfig: vi.fn(async () => dunning),
  };
}

function store(find: PlanDefinitionStore["find"]): PlanDefinitionStore {
  return {
    find,
    list: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
    recordAudit: vi.fn(),
    history: vi.fn(),
  } as unknown as PlanDefinitionStore;
}

describe("PlanDefinitionConfigProvider", () => {
  it("prefers a staff-authored plan definition over the baseline", async () => {
    const baseline = baselineProvider();
    const provider = new PlanDefinitionConfigProvider(
      baseline,
      store(async () => ({
        plan: "pro",
        limits: STAFF_AUTHORED,
        updatedAt: new Date(),
        updatedBy: "stf_test",
      })),
    );

    expect(await provider.getEntitlementDefaults("pro")).toEqual(STAFF_AUTHORED);
    expect(baseline.getEntitlementDefaults).not.toHaveBeenCalled();
  });

  it("falls through to the baseline when no definition row exists", async () => {
    const baseline = baselineProvider();
    const provider = new PlanDefinitionConfigProvider(
      baseline,
      store(async () => undefined),
    );

    expect(await provider.getEntitlementDefaults("free")).toEqual(BASELINE);
    expect(baseline.getEntitlementDefaults).toHaveBeenCalledWith("free");
  });

  it("falls through to the baseline when the store throws", async () => {
    const baseline = baselineProvider();
    const provider = new PlanDefinitionConfigProvider(
      baseline,
      store(async () => {
        throw new Error("connection refused");
      }),
    );

    expect(await provider.getEntitlementDefaults("free")).toEqual(BASELINE);
    expect(baseline.getEntitlementDefaults).toHaveBeenCalledWith("free");
  });

  it("returns a copy, so a caller cannot mutate the stored limits", async () => {
    const stored = { ...STAFF_AUTHORED };
    const provider = new PlanDefinitionConfigProvider(
      baselineProvider(),
      store(async () => ({
        plan: "pro",
        limits: stored,
        updatedAt: new Date(),
        updatedBy: "stf_test",
      })),
    );

    const limits = await provider.getEntitlementDefaults("pro");
    limits.maxWorkflows = 0;

    expect(stored.maxWorkflows).toBe(STAFF_AUTHORED.maxWorkflows);
  });

  it("passes abuse thresholds and dunning config straight through", async () => {
    const baseline = baselineProvider();
    const provider = new PlanDefinitionConfigProvider(
      baseline,
      store(async () => undefined),
    );

    expect(await provider.getAbuseThresholds()).toBe(abuse);
    expect(await provider.getDunningConfig()).toBe(dunning);
  });
});
