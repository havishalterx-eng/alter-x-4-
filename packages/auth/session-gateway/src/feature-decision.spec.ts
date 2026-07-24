import { describe, expect, it } from "vitest";
import { SESSION_GATEWAY_FEATURE_DECISION } from "./feature-decision";

describe("Session Gateway feature decision", () => {
  it("matches the CEO-approved INGR-2 rollout decision", () => {
    expect(SESSION_GATEWAY_FEATURE_DECISION).toEqual({
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
    });
  });
});
