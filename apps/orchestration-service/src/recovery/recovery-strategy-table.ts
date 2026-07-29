import type { FailureClass } from "@alterx/contracts";

/**
 * The 10 DB-locked values on recovery_actions.strategy (0014/0017
 * migrations). "retry" and "backoff" are two distinct strategies, not one
 * "retry+backoff" pair -- backoff is reserved for rate-limit-shaped
 * failures that need spacing, retry is for a plain transient re-attempt.
 */
export type RecoveryStrategy =
  | "repair"
  | "retry"
  | "backoff"
  | "swap_agent"
  | "escalate_model"
  | "recompile"
  | "replan"
  | "degrade"
  | "ask_user"
  | "terminate";

/**
 * Real dispatch exists today (RecoveryDispatchService) for these 8.
 * `recompile` shares `replan`'s real mechanism (no narrower
 * "recompile without a new plan" primitive exists -- Self-Healing
 * exit-check closure, disclosed merge, not two independent paths).
 * `retry`/`backoff` send a real nodeRetryDecidedSignal to the run's
 * Executor workflow (Self-Healing exit-check closure -- see
 * executor-workflow.ts's executeNodeWithRecovery). The remaining 2
 * (repair, swap_agent) are selected correctly by the deterministic table
 * below (a real, auditable decision lands in recovery_actions.strategy)
 * but have no real system to call yet -- dispatch honestly reports them
 * as deferred instead of pretending to have acted. See PR bodies for the
 * gap behind each one.
 */
export const DISPATCHABLE_STRATEGIES = new Set<RecoveryStrategy>([
  "escalate_model",
  "replan",
  "recompile",
  "retry",
  "backoff",
  "degrade",
  "ask_user",
  "terminate",
]);

/** Interim identifier pending the real Policy Store (Knowledge phase). */
export const POLICY_ID = "pol_00000000-0000-7000-8000-000000000001";
export const POLICY_VERSION = "heal6-deterministic-v1";

export interface StrategyDecision {
  readonly strategy: RecoveryStrategy;
  readonly policyId: string;
  readonly policyVersion: string;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled failure_class in policy table: ${String(value)}`);
}

/**
 * Deterministic (doc 11 HEAL-5/6 law: no LLM decides the strategy itself --
 * HEAL-5 already spent its ADVANCED call on root-cause estimation only).
 * Escalates on repeat attempts of the same node rather than retrying the
 * same failure class forever.
 *
 * Known gap: `RootCauseEstimateSchema` (the locked HEAL-5 -> HEAL-6
 * handoff) does not persist HEAL-3's optional `safety_severity` signal --
 * only `FailureObservationSchema` carries it, and that observation is not
 * stored on `recovery_actions`. Auto-terminating on "critical" severity
 * therefore has no real data to read at this point and is NOT implemented
 * here: every `safety_violation` routes to `ask_user` so a human makes the
 * terminate call, rather than this table guessing at a severity it can't
 * see. Carrying `safety_severity` through to `recovery_actions` is a
 * disclosed follow-up, not something to invent silently here.
 */
export function selectRecoveryStrategy(
  failureClass: FailureClass,
  nodeAttempt: number,
): StrategyDecision {
  const strategy = decide(failureClass, nodeAttempt);
  return { strategy, policyId: POLICY_ID, policyVersion: POLICY_VERSION };
}

function decide(failureClass: FailureClass, nodeAttempt: number): RecoveryStrategy {
  switch (failureClass) {
    case "safety_violation":
      // See known-gap note above: severity isn't available here, so this
      // never auto-selects "terminate" -- a human decides that escalation.
      return "ask_user";
    case "tool_permission_denial":
      // A human/credential-owner action is required; never auto-retryable.
      return "ask_user";
    case "rate_limit":
      return "backoff";
    case "timeout":
      return nodeAttempt <= 1 ? "retry" : "swap_agent";
    case "infrastructure_failure":
      return nodeAttempt <= 1 ? "retry" : "swap_agent";
    case "sandbox_crash":
      return nodeAttempt <= 1 ? "retry" : "recompile";
    case "logic_output_failure":
      return nodeAttempt <= 1 ? "escalate_model" : "replan";
    case "unknown":
      return "ask_user";
    default:
      return assertNever(failureClass);
  }
}
