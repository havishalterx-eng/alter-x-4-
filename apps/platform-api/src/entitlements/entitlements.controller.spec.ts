import { describe, expect, it, vi } from "vitest";
import { tenantRolesMetadataKey } from "../rbac/rbac.metadata";
import type { ActorContext } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import type { EntitlementProvider } from "./entitlement-provider.interface";
import { EntitlementsController } from "./entitlements.controller";
import type { EffectiveEntitlement } from "./types";

const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";

const entitlement: EffectiveEntitlement = {
  tenantId: tenantA,
  plan: "pro",
  limits: {
    maxWorkflows: 20,
    maxProjects: 10,
    maxRunsPerDay: 1_000,
    maxConcurrentRuns: 10,
    maxSandboxMinutesPerMonth: 5_000,
    maxAdsStorageMb: 10_000,
    maxIntegrations: 25,
  },
  accessState: "active",
  source: "config",
};

describe("EntitlementsController", () => {
  it("returns provider response unchanged for authenticated tenant", async () => {
    const provider = providerReturning(entitlement);
    const controller = new EntitlementsController(provider);

    await expect(controller.get(actor(tenantA))).resolves.toBe(entitlement);
    expect(provider.getEffectiveEntitlement).toHaveBeenCalledOnce();
    expect(provider.getEffectiveEntitlement).toHaveBeenCalledWith(tenantA);
  });

  it("derives tenant solely from actor context", async () => {
    const tenantBEntitlement = { ...entitlement, tenantId: tenantB };
    const provider = providerReturning(tenantBEntitlement);
    const controller = new EntitlementsController(provider);

    await expect(controller.get(actor(tenantB))).resolves.toBe(
      tenantBEntitlement,
    );
    expect(provider.getEffectiveEntitlement).toHaveBeenCalledWith(tenantB);
  });

  it("rejects missing actor with authentication problem", () => {
    const controller = new EntitlementsController(providerReturning(entitlement));
    let thrown: unknown;
    try {
      controller.get();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PlatformHttpError);
    const problem = thrown as PlatformHttpError;
    expect(problem.getStatus()).toBe(401);
    expect(problem.getResponse()).toMatchObject({
      error_code: "AUTHENTICATION_REQUIRED",
      instance: "/api/v1/entitlements",
    });
  });

  it("requires tenant member role", () => {
    expect(
      Reflect.getMetadata(tenantRolesMetadataKey, EntitlementsController),
    ).toEqual(["member"]);
  });
});

function actor(tenantId: string): ActorContext {
  return {
    user_id: "00000000-0000-7000-8000-000000000201",
    tenant_id: tenantId,
    roles: ["member"],
    permissions: [],
    session_id: "00000000-0000-7000-8000-000000000301",
  };
}

function providerReturning(
  value: EffectiveEntitlement,
): EntitlementProvider {
  return {
    getEffectiveEntitlement: vi.fn().mockResolvedValue(value),
    checkLimit: vi.fn(),
    createEntitlement: vi.fn(),
  };
}
