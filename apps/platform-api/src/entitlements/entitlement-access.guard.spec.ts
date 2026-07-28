import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import {
  permissionsMetadataKey,
  publicRouteMetadataKey,
} from "../rbac/rbac.metadata";
import { EntitlementAccessGuard } from "./entitlement-access.guard";
import type { EntitlementProvider } from "./entitlement-provider.interface";

describe("EntitlementAccessGuard", () => {
  it("blocks privileged actions while suspended", async () => {
    const reflector = reflectorWith({
      [String(permissionsMetadataKey)]: ["billing:write"],
    });
    const entitlements = provider("suspended");
    const guard = new EntitlementAccessGuard(reflector, entitlements);

    await expect(guard.canActivate(context())).rejects.toMatchObject({
      problem: { error_code: "RBAC_PERMISSION_DENIED" },
    });
    expect(entitlements.getEffectiveEntitlement).toHaveBeenCalledWith(
      "tenant-1",
    );
  });

  it("allows active writes, reads, public routes, and missing actor passthrough", async () => {
    await expect(
      new EntitlementAccessGuard(
        reflectorWith({
          [String(permissionsMetadataKey)]: ["projects:write"],
        }),
        provider("active"),
      ).canActivate(context()),
    ).resolves.toBe(true);

    const readProvider = provider("suspended");
    await expect(
      new EntitlementAccessGuard(
        reflectorWith({
          [String(permissionsMetadataKey)]: ["runs:read"],
        }),
        readProvider,
      ).canActivate(context()),
    ).resolves.toBe(true);
    expect(readProvider.getEffectiveEntitlement).not.toHaveBeenCalled();

    await expect(
      new EntitlementAccessGuard(
        reflectorWith({ [String(publicRouteMetadataKey)]: true }),
        provider("suspended"),
      ).canActivate(context()),
    ).resolves.toBe(true);

    await expect(
      new EntitlementAccessGuard(
        reflectorWith({
          [String(permissionsMetadataKey)]: ["billing:write"],
        }),
        provider("suspended"),
      ).canActivate(context(false)),
    ).resolves.toBe(true);
  });
});

function provider(accessState: "active" | "suspended"): EntitlementProvider {
  return {
    getEffectiveEntitlement: vi.fn(async () => ({
      tenantId: "tenant-1",
      plan: "plan_pro",
      limits: {
        maxWorkflows: 1,
        maxProjects: 1,
        maxRunsPerDay: 1,
        maxConcurrentRuns: 1,
        maxSandboxMinutesPerMonth: 1,
        maxAdsStorageMb: 1,
        maxIntegrations: 1,
      },
      accessState,
      source: "config" as const,
    })),
    checkLimit: vi.fn(),
    createEntitlement: vi.fn(),
  };
}

function reflectorWith(values: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: vi.fn((key: symbol) => values[String(key)]),
  } as unknown as Reflector;
}

function context(withActor = true): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({
        url: "/privileged",
        ...(withActor
          ? {
              actorContext: {
                tenant_id: "tenant-1",
                user_id: "user-1",
                session_id: "session-1",
                roles: ["owner"],
                permissions: ["billing:write"],
              },
            }
          : {}),
      }),
    }),
  } as unknown as ExecutionContext;
}
