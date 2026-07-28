import { Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ConfigProvider } from "./config-provider.interface";
import type {
  EntitlementProvider,
} from "./entitlement-provider.interface";
import type { EntitlementRow, EntitlementStore } from "./entitlement-store";
import {
  EMERGENCY_FREE_LIMITS,
  type EffectiveEntitlement,
  type EntitlementAccessState,
  type EntitlementLimitKey,
  type EntitlementLimits,
  type LimitCheckResult,
} from "./types";

export class InternalEntitlementProvider implements EntitlementProvider {
  private readonly logger = new Logger(InternalEntitlementProvider.name);

  constructor(
    private readonly store: EntitlementStore,
    private readonly configProvider: ConfigProvider,
  ) {}

  async getEffectiveEntitlement(tenantId: string): Promise<EffectiveEntitlement> {
    const row = await this.store.findEffective(tenantId);
    return this.resolve(
      tenantId,
      row ?? {
        tenantId,
        plan: "free",
        limits: null,
        accessState: "active",
      },
    );
  }

  async checkLimit(
    tenantId: string,
    limitKey: EntitlementLimitKey,
    currentUsage: number,
  ): Promise<LimitCheckResult> {
    if (!Number.isFinite(currentUsage) || currentUsage < 0) {
      throw new Error("currentUsage must be a non-negative number");
    }
    const limit = (await this.getEffectiveEntitlement(tenantId)).limits[limitKey];
    const remaining = Math.max(0, limit - currentUsage);
    if (currentUsage > limit) {
      return { allowed: false, reason: "LIMIT_EXCEEDED", limit, currentUsage, remaining };
    }
    if (currentUsage === limit) {
      return { allowed: false, reason: "LIMIT_REACHED", limit, currentUsage, remaining };
    }
    return { allowed: true, reason: "LIMIT_AVAILABLE", limit, currentUsage, remaining };
  }

  async createEntitlement(
    tenantId: string,
    plan: string,
    transactionClient?: PoolClient,
    options?: {
      accessState?: EntitlementAccessState;
      limits?: Partial<EntitlementLimits>;
    },
  ): Promise<EffectiveEntitlement> {
    const row = transactionClient
      ? await this.store.create(tenantId, plan, transactionClient, options)
      : await this.store.create(tenantId, plan, undefined, options);
    return this.resolve(tenantId, row);
  }

  private async resolve(
    tenantId: string,
    row: EntitlementRow,
  ): Promise<EffectiveEntitlement> {
    let defaults: EntitlementLimits;
    let source: EffectiveEntitlement["source"] = "config";
    try {
      defaults = await this.configProvider.getEntitlementDefaults(row.plan);
    } catch (error) {
      this.logger.error(
        `Entitlement ConfigProvider unavailable; applying emergency free-tier floor for tenant ${tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
      defaults = { ...EMERGENCY_FREE_LIMITS };
      source = "emergency-fallback";
    }

    const overrides = this.validOverrides(row.limits);
    if (Object.keys(overrides).length > 0 && source !== "emergency-fallback") {
      source = "tenant-override";
    }
    return {
      tenantId,
      plan: row.plan,
      limits: { ...defaults, ...overrides },
      accessState: row.accessState,
      source,
    };
  }

  private validOverrides(
    limits: Partial<EntitlementLimits> | null,
  ): Partial<EntitlementLimits> {
    if (!limits) return {};
    return Object.fromEntries(
      Object.entries(limits).filter(
        ([, value]) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0,
      ),
    ) as Partial<EntitlementLimits>;
  }
}
