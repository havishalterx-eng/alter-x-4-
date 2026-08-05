import type { JsonValue } from "@alterx/shared-clients";

export type DiscoveryRiskLevel = "low" | "medium" | "high";
export type DiscoveryRecommendationStatus = "suggested" | "accepted" | "dismissed";

export interface DiscoveryRecommendation {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly problemStatement: string;
  readonly evidence: Readonly<Record<string, JsonValue>>;
  readonly estimatedValue: number;
  readonly estimatedEffort: number;
  readonly requiredIntegrations: readonly string[];
  readonly riskLevel: DiscoveryRiskLevel;
  readonly confidence: number;
  readonly status: DiscoveryRecommendationStatus;
  readonly createdAt: string;
}

export interface DiscoverySignal {
  readonly id: string;
  readonly kind?: string;
}

export interface DiscoverySignals {
  readonly runs: readonly DiscoverySignal[];
  readonly adsDocuments: readonly DiscoverySignal[];
  readonly decidedApprovals: readonly DiscoverySignal[];
  readonly connectorActivity: readonly (DiscoverySignal & { readonly connector: string })[];
}

export interface DiscoveryCandidate {
  readonly problemStatement: string;
  readonly evidence: Readonly<Record<string, JsonValue>>;
  readonly estimatedValue: number;
  readonly estimatedEffort: number;
  readonly requiredIntegrations: readonly string[];
  readonly riskLevel: DiscoveryRiskLevel;
  readonly confidence: number;
}
