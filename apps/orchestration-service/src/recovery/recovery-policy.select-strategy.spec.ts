import { describe, expect, it, vi } from "vitest";

import type { RecoverySelectStrategyRequest } from "@alterx/contracts";

import type { RecoveryDispatchService } from "./recovery-dispatch.service";
import {
  RecoveryActionNotClassifiedError,
  RecoveryPolicyService,
  type RecoveryTenantStore,
} from "./recovery-policy.service";

const TENANT_ID = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const BARE_TENANT_ID = TENANT_ID.slice("ten_".length);
const RUN_ID = "run_018f47a5-7b2c-7d10-8f11-123456789abc";
const NODE_ID = "node_018f47a5-7b2c-7d10-8f11-123456789abc";
const RECOVERY_ID = "rec_018f47a5-7b2c-7d10-8f11-123456789abc";

interface FakeRow {
  id: string;
  tenant_id: string;
  run_id: string;
  node_execution_id: string;
  failure_class: string;
  strategy: string | null;
  policy_version: string | null;
  outcome: string | null;
}

/**
 * Minimal in-memory recovery_actions table -- just enough to exercise
 * selectStrategy's real SQL shapes (#loadDecided/#persistStrategy/
 * #persistOutcome) without a real Postgres instance. Purpose-built for the
 * idempotency/resume regression below, not a general-purpose fake.
 */
function fakeStore(rows: FakeRow[]): RecoveryTenantStore {
  return {
    async withTenant<T>(
      tenantId: string,
      operation: (tx: { query: (sql: string, values?: readonly unknown[]) => Promise<{ rowCount: number; rows: unknown[] }> }) => Promise<T>,
    ): Promise<T> {
      expect(tenantId).toBe(BARE_TENANT_ID);
      return operation({
        async query(sql, values = []) {
          if (sql.includes("SELECT id, strategy, policy_version, outcome")) {
            const runId = String(values[1]);
            const nodeExecutionId = String(values[2]);
            const failureClass = String(values[3]);
            const match = rows.find(
              (r) =>
                r.run_id === runId &&
                r.node_execution_id === nodeExecutionId &&
                r.failure_class === failureClass,
            );
            return match === undefined
              ? { rowCount: 0, rows: [] }
              : { rowCount: 1, rows: [{ ...match }] };
          }
          if (sql.includes("UPDATE recovery_actions") && sql.includes("SET strategy")) {
            const strategy = String(values[0]);
            const policyVersion = String(values[1]);
            const runId = String(values[3]);
            const nodeExecutionId = String(values[4]);
            const failureClass = String(values[5]);
            const match = rows.find(
              (r) =>
                r.run_id === runId &&
                r.node_execution_id === nodeExecutionId &&
                r.failure_class === failureClass &&
                r.strategy === null,
            );
            if (match === undefined) return { rowCount: 0, rows: [] };
            match.strategy = strategy;
            match.policy_version = policyVersion;
            return { rowCount: 1, rows: [{ id: match.id }] };
          }
          if (sql.includes("UPDATE recovery_actions") && sql.includes("SET outcome")) {
            const outcome = String(values[0]);
            const recoveryActionId = String(values[2]);
            const runId = String(values[3]);
            const strategy = String(values[4]);
            const match = rows.find(
              (r) =>
                r.id === recoveryActionId &&
                r.run_id === runId &&
                r.strategy === strategy &&
                r.outcome === null,
            );
            if (match === undefined) return { rowCount: 0, rows: [] };
            match.outcome = outcome;
            return { rowCount: 1, rows: [{ id: match.id }] };
          }
          throw new Error(`Unexpected SQL in fake store: ${sql}`);
        },
      });
    },
  } as unknown as RecoveryTenantStore;
}

function selectRequest(): RecoverySelectStrategyRequest {
  return {
    tenant_id: TENANT_ID,
    run_id: RUN_ID,
    node_execution_id: NODE_ID,
    failure_class: "timeout",
    root_cause_estimate_json: JSON.stringify({
      schema_version: "heal5.v1",
      failure_class: "timeout",
      explanation: "transient timeout",
      confidence: 0.9,
      evidence: ["TIMEOUT"],
      node_attempt: 1,
      model_alias: "ADVANCED",
      resolved_capability: "ADVANCED:test",
    }),
  };
}

function pendingRow(): FakeRow {
  return {
    id: RECOVERY_ID,
    tenant_id: BARE_TENANT_ID,
    run_id: RUN_ID,
    node_execution_id: NODE_ID,
    failure_class: "timeout",
    strategy: null,
    policy_version: null,
    outcome: null,
  };
}

describe("RecoveryPolicyService.selectStrategy -- idempotency", () => {
  it("first call: decides, dispatches exactly once, and persists the outcome", async () => {
    const rows = [pendingRow()];
    const store = fakeStore(rows);
    const dispatch = {
      dispatch: vi.fn().mockResolvedValue({ outcome: "resolved", detail: "test" }),
    } as unknown as RecoveryDispatchService;
    const service = new RecoveryPolicyService(store, {} as never, dispatch);

    const response = await service.selectStrategy(selectRequest());

    expect(response.strategy).toBe("retry");
    expect(dispatch.dispatch).toHaveBeenCalledTimes(1);
    expect(rows[0]?.strategy).toBe("retry");
    expect(rows[0]?.outcome).toBe("resolved");
  });

  it("resumes dispatch (does not re-decide, does not skip dispatch) when a prior call crashed after choosing a strategy but before recording an outcome", async () => {
    const row = pendingRow();
    row.strategy = "retry"; // strategy already chosen by a prior, interrupted call
    row.policy_version = "heal6-deterministic-v1";
    row.outcome = null; // ...but dispatch/outcome never completed
    const rows = [row];
    const store = fakeStore(rows);
    const dispatch = {
      dispatch: vi.fn().mockResolvedValue({ outcome: "resolved", detail: "resumed" }),
    } as unknown as RecoveryDispatchService;
    const service = new RecoveryPolicyService(store, {} as never, dispatch);

    const response = await service.selectStrategy(selectRequest());

    // Must resume with the SAME strategy already chosen, not re-decide.
    expect(response.strategy).toBe("retry");
    expect(response.recovery_action_id).toBe(RECOVERY_ID);
    // Must actually dispatch -- this is the regression this test guards:
    // treating "strategy already set" as "already done" would skip this.
    expect(dispatch.dispatch).toHaveBeenCalledTimes(1);
    expect(rows[0]?.outcome).toBe("resolved");
  });

  it("is a true no-op replay once outcome is already recorded -- never dispatches twice", async () => {
    const row = pendingRow();
    row.strategy = "retry";
    row.policy_version = "heal6-deterministic-v1";
    row.outcome = "resolved"; // fully resolved already
    const rows = [row];
    const store = fakeStore(rows);
    const dispatch = {
      dispatch: vi.fn().mockResolvedValue({ outcome: "resolved", detail: "should not run" }),
    } as unknown as RecoveryDispatchService;
    const service = new RecoveryPolicyService(store, {} as never, dispatch);

    const response = await service.selectStrategy(selectRequest());

    expect(response.strategy).toBe("retry");
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it("throws RecoveryActionNotClassifiedError if classifyFailure was never called for this node", async () => {
    const store = fakeStore([]); // no pending row at all
    const dispatch = {
      dispatch: vi.fn(),
    } as unknown as RecoveryDispatchService;
    const service = new RecoveryPolicyService(store, {} as never, dispatch);

    await expect(service.selectStrategy(selectRequest())).rejects.toBeInstanceOf(
      RecoveryActionNotClassifiedError,
    );
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });
});
