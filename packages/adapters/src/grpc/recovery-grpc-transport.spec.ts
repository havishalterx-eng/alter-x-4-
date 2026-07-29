import { describe, expect, it, vi } from "vitest";

import type { RecoveryClassifyFailureRequest } from "@alterx/contracts";
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

  it("leaves HEAL-6 strategy selection and outcome recording unimplemented", () => {
    const controller = new RecoveryGrpcController(handler());
    expect(() => controller.selectStrategy()).toThrow();
    expect(() => controller.recordOutcome()).toThrow();
    for (const operation of [
      () => controller.selectStrategy(),
      () => controller.recordOutcome(),
    ]) {
      try {
        operation();
      } catch (error: unknown) {
        expect(error).toMatchObject({ error: { code: 12 } });
      }
    }
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
