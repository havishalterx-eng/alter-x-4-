import { describe, expect, it, vi } from "vitest";

import type {
  RunsGetNodeExecutionRecoveryInfoRequest,
  RunsGetRunWorkspaceRequest,
} from "@alterx/contracts";
import { RunsGrpcController, type RunsHandler } from "./runs-grpc-transport";

const REQUEST: RunsGetRunWorkspaceRequest = {
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  run_id: "run_018f47a5-7b2c-7d10-8f11-123456789abc",
};

const RECOVERY_INFO_REQUEST: RunsGetNodeExecutionRecoveryInfoRequest = {
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  run_id: "run_018f47a5-7b2c-7d10-8f11-123456789abc",
  node_execution_id: "node_018f47a5-7b2c-7d10-8f11-123456789abc",
};

class NamedRunsError extends Error {
  constructor(name: string) {
    super("safe run lookup error");
    this.name = name;
  }
}

function handler(): RunsHandler {
  return {
    getRunWorkspace: vi.fn(async () => ({
      workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
    })),
    getNodeExecutionRecoveryInfo: vi.fn(async () => ({
      is_retry: false,
      is_recovery: false,
    })),
  };
}

describe("RunsGrpcController", () => {
  it("delegates the locked GetRunWorkspace request/response shape", async () => {
    const runsHandler = handler();
    const controller = new RunsGrpcController(runsHandler);
    await expect(controller.getRunWorkspace(REQUEST)).resolves.toEqual({
      workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
    });
    expect(runsHandler.getRunWorkspace).toHaveBeenCalledWith(REQUEST);
  });

  it.each([
    ["RunValidationError", 3],
    ["RunNotFoundError", 5],
  ] as const)("maps %s to gRPC status %s", async (name, code) => {
    const failing = handler();
    failing.getRunWorkspace = vi.fn(async () => {
      throw new NamedRunsError(name);
    });
    const controller = new RunsGrpcController(failing);
    await expect(controller.getRunWorkspace(REQUEST)).rejects.toMatchObject({
      error: { code },
    });
  });

  it("hides unexpected internal details", async () => {
    const failing = handler();
    failing.getRunWorkspace = vi.fn(async () => {
      throw new Error("database credential leaked if propagated");
    });
    const controller = new RunsGrpcController(failing);
    await expect(controller.getRunWorkspace(REQUEST)).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Run workspace lookup could not be completed",
      },
    });
  });

  it("delegates the real GetNodeExecutionRecoveryInfo request/response shape (OUT-5)", async () => {
    const runsHandler = handler();
    runsHandler.getNodeExecutionRecoveryInfo = vi.fn(async () => ({
      is_retry: true,
      is_recovery: false,
    }));
    const controller = new RunsGrpcController(runsHandler);
    await expect(
      controller.getNodeExecutionRecoveryInfo(RECOVERY_INFO_REQUEST),
    ).resolves.toEqual({ is_retry: true, is_recovery: false });
    expect(runsHandler.getNodeExecutionRecoveryInfo).toHaveBeenCalledWith(
      RECOVERY_INFO_REQUEST,
    );
  });

  it("maps NodeExecutionNotFoundError to gRPC NOT_FOUND", async () => {
    const failing = handler();
    failing.getNodeExecutionRecoveryInfo = vi.fn(async () => {
      throw new NamedRunsError("NodeExecutionNotFoundError");
    });
    const controller = new RunsGrpcController(failing);
    await expect(
      controller.getNodeExecutionRecoveryInfo(RECOVERY_INFO_REQUEST),
    ).rejects.toMatchObject({ error: { code: 5 } });
  });
});
