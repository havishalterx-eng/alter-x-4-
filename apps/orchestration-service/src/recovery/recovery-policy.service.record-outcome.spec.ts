import { describe, expect, it, vi } from "vitest";

import type { ModelGatewayHandler } from "@alterx/adapters";
import type { RecoveryDispatchService } from "./recovery-dispatch.service";
import type { EscalationsService } from "../escalations/escalations.service";
import { RecoveryPolicyService, type RecoveryTenantStore } from "./recovery-policy.service";

const NOOP_DISPATCH = {} as unknown as RecoveryDispatchService;
const NOOP_MODEL = {} as unknown as ModelGatewayHandler;

const TENANT_ID = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const RUN_ID = "run_018f47a5-7b2c-7d10-8f11-123456789abc";
const NODE_ID = "node_018f47a5-7b2c-7d10-8f11-123456789abc";
const RECOVERY_ID = "rec_018f47a5-7b2c-7d10-8f11-123456789abc";

function storeReturning(row: Record<string, unknown> | undefined): RecoveryTenantStore {
  return {
    withTenant: vi.fn(async (_tenantId: string, operation: (tx: unknown) => unknown) =>
      operation({
        query: vi.fn(async () => ({
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        })),
      }),
    ),
  } as unknown as RecoveryTenantStore;
}

describe("RecoveryPolicyService.recordOutcome", () => {
  it("creates a real escalation row when outcome is 'escalated' and escalations is wired", async () => {
    const store = storeReturning({
      id: RECOVERY_ID,
      node_execution_id: NODE_ID,
      failure_class: "model_error",
    });
    const escalations = {
      create: vi.fn(async () => ({ id: "esc_test" })),
    } as unknown as EscalationsService;

    const service = new RecoveryPolicyService(
      store,
      NOOP_MODEL,
      NOOP_DISPATCH,
      () => RECOVERY_ID,
      undefined,
      escalations,
    );

    await service.recordOutcome({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      recovery_action_id: RECOVERY_ID,
      strategy: "swap_agent",
      outcome: "escalated",
    });

    expect(escalations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        runId: RUN_ID,
        nodeExecutionId: NODE_ID,
        recoveryActionId: RECOVERY_ID,
      }),
    );
  });

  it("does not attempt escalation creation for a non-escalated outcome", async () => {
    const store = storeReturning({
      id: RECOVERY_ID,
      node_execution_id: NODE_ID,
      failure_class: "model_error",
    });
    const escalations = { create: vi.fn() } as unknown as EscalationsService;
    const service = new RecoveryPolicyService(
      store,
      NOOP_MODEL,
      NOOP_DISPATCH,
      () => RECOVERY_ID,
      undefined,
      escalations,
    );

    await service.recordOutcome({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      recovery_action_id: RECOVERY_ID,
      strategy: "retry",
      outcome: "resolved",
    });

    expect(escalations.create).not.toHaveBeenCalled();
  });

  it("still records the real recovery outcome when escalations is not wired", async () => {
    const store = storeReturning({
      id: RECOVERY_ID,
      node_execution_id: NODE_ID,
      failure_class: "model_error",
    });
    const service = new RecoveryPolicyService(store, NOOP_MODEL, NOOP_DISPATCH, () => RECOVERY_ID);

    await expect(
      service.recordOutcome({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        recovery_action_id: RECOVERY_ID,
        strategy: "swap_agent",
        outcome: "escalated",
      }),
    ).resolves.toEqual({ recorded: true });
  });

  it("does not let a real escalation-creation failure surface as a recordOutcome failure", async () => {
    const store = storeReturning({
      id: RECOVERY_ID,
      node_execution_id: NODE_ID,
      failure_class: "model_error",
    });
    const escalations = {
      create: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
    } as unknown as EscalationsService;
    const service = new RecoveryPolicyService(
      store,
      NOOP_MODEL,
      NOOP_DISPATCH,
      () => RECOVERY_ID,
      undefined,
      escalations,
    );

    await expect(
      service.recordOutcome({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        recovery_action_id: RECOVERY_ID,
        strategy: "swap_agent",
        outcome: "escalated",
      }),
    ).resolves.toEqual({ recorded: true });
  });
});
