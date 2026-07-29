import { describe, expect, it } from "vitest";

import type { FailureClass } from "@alterx/contracts";

import {
  POLICY_ID,
  POLICY_VERSION,
  selectRecoveryStrategy,
  type RecoveryStrategy,
} from "./recovery-strategy-table";

const ALL_FAILURE_CLASSES: readonly FailureClass[] = [
  "infrastructure_failure",
  "logic_output_failure",
  "timeout",
  "tool_permission_denial",
  "sandbox_crash",
  "rate_limit",
  "safety_violation",
  "unknown",
];

describe("selectRecoveryStrategy", () => {
  it("never throws for any locked FailureClassSchema value (exhaustiveness guarantee)", () => {
    for (const failureClass of ALL_FAILURE_CLASSES) {
      expect(() => selectRecoveryStrategy(failureClass, 1)).not.toThrow();
      expect(() => selectRecoveryStrategy(failureClass, 5)).not.toThrow();
    }
  });

  it("always returns the current policy id and version", () => {
    const decision = selectRecoveryStrategy("timeout", 1);
    expect(decision.policyId).toBe(POLICY_ID);
    expect(decision.policyVersion).toBe(POLICY_VERSION);
  });

  it("is deterministic: same inputs always produce the same strategy", () => {
    for (const failureClass of ALL_FAILURE_CLASSES) {
      const first = selectRecoveryStrategy(failureClass, 2);
      const second = selectRecoveryStrategy(failureClass, 2);
      expect(second.strategy).toBe(first.strategy);
    }
  });

  it.each([
    ["tool_permission_denial", 1, "ask_user"],
    ["tool_permission_denial", 5, "ask_user"],
    ["rate_limit", 1, "backoff"],
    ["timeout", 1, "retry"],
    ["timeout", 2, "swap_agent"],
    ["infrastructure_failure", 1, "retry"],
    ["infrastructure_failure", 2, "swap_agent"],
    ["sandbox_crash", 1, "retry"],
    ["sandbox_crash", 2, "recompile"],
    ["logic_output_failure", 1, "escalate_model"],
    ["logic_output_failure", 2, "replan"],
    ["safety_violation", 1, "ask_user"],
    ["safety_violation", 5, "ask_user"],
    ["unknown", 1, "ask_user"],
  ] as const)(
    "%s at attempt %i selects %s",
    (failureClass, attempt, expected: RecoveryStrategy) => {
      expect(selectRecoveryStrategy(failureClass, attempt).strategy).toBe(expected);
    },
  );

  it("never auto-selects terminate (no real severity signal reaches this table -- see known-gap doc comment)", () => {
    for (const failureClass of ALL_FAILURE_CLASSES) {
      for (const attempt of [1, 2, 3, 10]) {
        expect(selectRecoveryStrategy(failureClass, attempt).strategy).not.toBe(
          "terminate",
        );
      }
    }
  });

  it("never selects repair (undefined concept -- disclosed, not invented)", () => {
    for (const failureClass of ALL_FAILURE_CLASSES) {
      for (const attempt of [1, 2, 3, 10]) {
        expect(selectRecoveryStrategy(failureClass, attempt).strategy).not.toBe(
          "repair",
        );
      }
    }
  });
});
