import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ConfigProvider } from "../../config-provider.interface";
import { parseConfigDocument } from "../../config-document";
import type {
  AbuseThresholds,
  DunningConfig,
  EntitlementLimits,
} from "../../types";

const defaultConfigPath = resolve(
  process.cwd(),
  "apps/platform-api/src/entitlements/adapters/local-file/default-limits.json",
);

export class LocalFileConfigProvider implements ConfigProvider {
  constructor(private readonly configPath = defaultConfigPath) {}

  async getEntitlementDefaults(plan: string): Promise<EntitlementLimits> {
    const document = await this.readDocument();
    const limits = document.plans[plan];
    if (!limits) {
      throw new Error(`No entitlement defaults configured for plan: ${plan}`);
    }
    return { ...limits };
  }

  async getAbuseThresholds(): Promise<AbuseThresholds> {
    const document = await this.readDocument();
    return { ...document.abuse };
  }

  async getDunningConfig(): Promise<DunningConfig> {
    const dunning = (await this.readDocument()).dunning;
    return {
      ...dunning,
      limitedStateLimits: { ...dunning.limitedStateLimits },
    };
  }

  private async readDocument() {
    return parseConfigDocument(await readFile(this.configPath, "utf8"));
  }
}
