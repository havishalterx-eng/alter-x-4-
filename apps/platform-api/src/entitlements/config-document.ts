import type {
  AbuseThresholds,
  DunningConfig,
  EntitlementLimits,
} from "./types";
import { ENTITLEMENT_LIMIT_KEYS } from "./types";

export interface EntitlementConfigDocument {
  plans: Record<string, EntitlementLimits>;
  abuse: AbuseThresholds;
  dunning: DunningConfig;
}

const abuseKeys: readonly (keyof AbuseThresholds)[] = [
  "tenantRequestsPerMinute",
  "userRequestsPerMinute",
  "verificationScoreThreshold",
  "purchasesPerDay",
  "purchaseAmountPerDay",
];

function assertPositiveNumbers(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, number> {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }

  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      throw new Error(`${label}.${key} must be a non-negative number`);
    }
  }
}

export function parseConfigDocument(input: string): EntitlementConfigDocument {
  const parsed: unknown = JSON.parse(input);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Entitlement config must be an object");
  }

  const document = parsed as Record<string, unknown>;
  if (!document.plans || typeof document.plans !== "object") {
    throw new Error("Entitlement config plans must be an object");
  }

  for (const [plan, limits] of Object.entries(document.plans)) {
    assertPositiveNumbers(limits, ENTITLEMENT_LIMIT_KEYS, `plans.${plan}`);
  }
  assertPositiveNumbers(document.abuse, abuseKeys, "abuse");
  if (!document.dunning || typeof document.dunning !== "object") {
    throw new Error("dunning must be an object");
  }
  const dunning = document.dunning as Record<string, unknown>;
  assertPositiveNumbers(
    dunning,
    ["gracePeriodSeconds", "suspensionThresholdSeconds"],
    "dunning",
  );
  assertPositiveNumbers(
    dunning.limitedStateLimits,
    ENTITLEMENT_LIMIT_KEYS,
    "dunning.limitedStateLimits",
  );
  if (
    (dunning.suspensionThresholdSeconds as number) <
    (dunning.gracePeriodSeconds as number)
  ) {
    throw new Error(
      "dunning.suspensionThresholdSeconds must be at least gracePeriodSeconds",
    );
  }

  return parsed as EntitlementConfigDocument;
}
