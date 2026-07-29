import { describe, expect, it, vi } from "vitest";

import type {
  RecoveryClassifyFailureRequest,
  RecoveryRecordOutcomeRequest,
  RecoverySelectStrategyRequest,
} from "@alterx/contracts";
import {
  RecoveryGrpcController,
  type RecoveryHandler,
} from "./recovery-grpc-transport";

const REQUEST: RecoveryClassifyFailureRequest = {
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  run_id: "run_018f47a5-7b2c-7d10-8f11-123456789abc",
  node_execution_id: "node_018f47a5-7b2c-7d10-8f11-123456789abc",
  error_json: "{}",
};

const SELECT_STRATEGY_REQUEST: RecoverySelectStrategyRequest = {
  tenant_id: REQUEST.tenant_id,
  run_id: REQUEST.run_id,
  node_execution_id: REQUEST.node_execution_id,
  failure_class: "timeout",
  root_cause_estimate_json: "{}",
};

const RECORD_OUTCOME_REQUEST: RecoveryRecordOutcomeRequest = {
  tenant_id: REQUEST.tenant_id,
  run_id: REQUEST.run_id,
  recovery_action_id: "rec_018f47a5-7b2c-7d10-8f11-123456789abc",
  strategy: "retry",
  outcome: "resolved",
};

class NamedRecoveryError extends Error {
  constructor(name: string) {
    super("safe classification error");
    this.name = name;
  }
}

function handler(): RecoveryHandler {
  return {
    classifyFailure: vi.fn(async () => ({
      failure_class: "timeout",
      confidence: 0.9,
      root_cause_estimate_json: "{}",
    })),
    selectStrategy: vi.fn(async () => ({
      recovery_action_id: "rec_018f47a5-7b2c-7d10-8f11-123456789abc",
      strategy: "retry",
      policy_id: "pol_00000000-0000-7000-8000-000000000001",
      policy_version: "heal6-deterministic-v1",
    })),
    recordOutcome: vi.fn(async () => ({ recorded: true })),
  };
}

describe("RecoveryGrpcController", () => {
  it("delegates the locked ClassifyFailure request/response shape", async () => {
    const recoveryHandler = handler();
    const controller = new RecoveryGrpcController(recoveryHandler);
    await expect(controller.classifyFailure(REQUEST)).resolves.toEqual({
      failure_class: "timeout",
      confidence: 0.9,
      root_cause_estimate_json: "{}",
    });
    expect(recoveryHandler.classifyFailure).toHaveBeenCalledWith(REQUEST);
  });

  it.each([
    ["RecoveryValidationError", 3],
    ["RecoveryNodeNotFoundError", 9],
    ["RecoveryRootCauseUnavailableError", 14],
    ["RecoveryPersistenceConflictError", 10],
  ] as const)("maps %s to gRPC status %s", async (name, code) => {
    const failing = handler();
    failing.classifyFailure = vi.fn(async () => {
      throw new NamedRecoveryError(name);
    });
    const controller = new RecoveryGrpcController(failing);
    await expect(controller.classifyFailure(REQUEST)).rejects.toMatchObject({
      error: { code },
    });
  });

  it("delegates the locked SelectStrategy request/response shape", async () => {
    const recoveryHandler = handler();
    const controller = new RecoveryGrpcController(recoveryHandler);
    await expect(
      controller.selectStrategy(SELECT_STRATEGY_REQUEST),
    ).resolves.toEqual({
      recovery_action_id: "rec_018f47a5-7b2c-7d10-8f11-123456789abc",
      strategy: "retry",
      policy_id: "pol_00000000-0000-7000-8000-000000000001",
      policy_version: "heal6-deterministic-v1",
    });
    expect(recoveryHandler.selectStrategy).toHaveBeenCalledWith(
      SELECT_STRATEGY_REQUEST,
    );
  });

  it("delegates the locked RecordOutcome request/response shape", async () => {
    const recoveryHandler = handler();
    const controller = new RecoveryGrpcController(recoveryHandler);
    await expect(
      controller.recordOutcome(RECORD_OUTCOME_REQUEST),
    ).resolves.toEqual({ recorded: true });
    expect(recoveryHandler.recordOutcome).toHaveBeenCalledWith(
      RECORD_OUTCOME_REQUEST,
    );
  });

  it.each([
    ["RecoveryActionNotClassifiedError", 9],
    ["RecoveryActionNotFoundError", 5],
  ] as const)("maps %s to gRPC status %s on SelectStrategy", async (name, code) => {
    const failing = handler();
    failing.selectStrategy = vi.fn(async () => {
      throw new NamedRecoveryError(name);
    });
    const controller = new RecoveryGrpcController(failing);
    await expect(
      controller.selectStrategy(SELECT_STRATEGY_REQUEST),
    ).rejects.toMatchObject({ error: { code } });
  });

  it("hides unexpected internal details", async () => {
    const failing = handler();
    failing.classifyFailure = vi.fn(async () => {
      throw new Error("database credential leaked if propagated");
    });
    const controller = new RecoveryGrpcController(failing);
    await expect(controller.classifyFailure(REQUEST)).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Failure classification could not be completed",
      },
    });
  });
});
