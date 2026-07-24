export interface SessionGatewayFeatureDecision {
  readonly ticket: "INGR-2";
  readonly featureId: "INGR-2";
  readonly featureFlag: "ingress.sessionGatewayCore";
  readonly owner: "CEO";
  readonly decisionDate: "2026-07-25";
  readonly status: "approved_feature_gated";
  readonly rollout: "merge allowed after CI/audit green; production enablement requires actor-token JWKS endpoint deployed and configured.";
  readonly reason: "INGR-2 is security-sensitive auth/session gateway; runtime enablement must stay feature-gated until JWKS endpoint is deployed.";
}

export const SESSION_GATEWAY_FEATURE_DECISION = {
  ticket: "INGR-2",
  featureId: "INGR-2",
  featureFlag: "ingress.sessionGatewayCore",
  owner: "CEO",
  decisionDate: "2026-07-25",
  status: "approved_feature_gated",
  rollout:
    "merge allowed after CI/audit green; production enablement requires actor-token JWKS endpoint deployed and configured.",
  reason:
    "INGR-2 is security-sensitive auth/session gateway; runtime enablement must stay feature-gated until JWKS endpoint is deployed.",
} as const satisfies SessionGatewayFeatureDecision;
