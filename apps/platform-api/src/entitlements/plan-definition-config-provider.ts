import { Logger } from "@nestjs/common";
import type { ConfigProvider } from "./config-provider.interface";
import type { PlanDefinitionStore } from "./plan-definition-store";
import type {
  AbuseThresholds,
  DunningConfig,
  EntitlementLimits,
} from "./types";

/**
 * Puts the staff-authored `plan_definitions` table in front of the deployed
 * ConfigProvider (AppConfig or local-file) for plan limit defaults only.
 *
 * - A row for the plan wins, and takes effect on the next resolution: no
 *   publish or reload step, which is the point of backing the staff console
 *   with Postgres instead of AppConfig's rollout-based distribution.
 * - No row falls through to the baseline provider, so an empty table means
 *   byte-identical behavior to before this layer existed.
 * - A store failure also falls through to the baseline rather than failing
 *   the request; InternalEntitlementProvider's emergency free-tier floor
 *   still backstops a baseline failure underneath that.
 *
 * Abuse thresholds and dunning config are not staff-writable here and pass
 * straight through.
 */
export class PlanDefinitionConfigProvider implements ConfigProvider {
  private readonly logger = new Logger(PlanDefinitionConfigProvider.name);

  constructor(
    private readonly baseline: ConfigProvider,
    private readonly store: PlanDefinitionStore,
  ) {}

  async getEntitlementDefaults(plan: string): Promise<EntitlementLimits> {
    try {
      const definition = await this.store.find(plan);
      if (definition) return { ...definition.limits };
    } catch (error) {
      this.logger.error(
        `plan_definitions unavailable for plan ${plan}; falling back to the baseline ConfigProvider`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return this.baseline.getEntitlementDefaults(plan);
  }

  getAbuseThresholds(): Promise<AbuseThresholds> {
    return this.baseline.getAbuseThresholds();
  }

  getDunningConfig(): Promise<DunningConfig> {
    return this.baseline.getDunningConfig();
  }
}
