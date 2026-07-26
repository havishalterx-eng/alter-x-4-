import { describe, expect, it, vi } from "vitest";

import type {
  DeployctlPromoteVersionRequest,
  DeployctlRollbackVersionRequest,
  DeployctlStartCanaryRequest,
} from "@alterx/contracts";
import {
  DeployctlGrpcController,
  type DeployctlHandler,
} from "./deployctl-grpc-transport";

const promoteRequest: DeployctlPromoteVersionRequest = {
  tenant_id: "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  workflow_id: "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  workflow_version_id: "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890a1",
};
const canaryRequest: DeployctlStartCanaryRequest = {
  ...promoteRequest,
  traffic_percent: 10,
};
const rollbackRequest: DeployctlRollbackVersionRequest = {
  tenant_id: promoteRequest.tenant_id,
  workflow_id: promoteRequest.workflow_id,
  target_version_id: promoteRequest.workflow_version_id,
};

function handler(): DeployctlHandler {
  return {
    promoteVersion: vi.fn(async () => ({
      status: "promoted",
      promoted_at: "2026-07-26T10:00:00.000Z",
    })),
    startCanary: vi.fn(async (request) => ({
      status: "canary",
      traffic_percent: request.traffic_percent,
    })),
    rollbackVersion: vi.fn(async (request) => ({
      status: "rolled_back",
      active_version_id: request.target_version_id,
    })),
  };
}

class NamedDeploymentError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

describe("DeployctlGrpcController", () => {
  it("delegates all three locked deployctl RPC shapes", async () => {
    const controller = new DeployctlGrpcController(handler());

    await expect(controller.promoteVersion(promoteRequest)).resolves.toEqual({
      status: "promoted",
      promoted_at: "2026-07-26T10:00:00.000Z",
    });
    await expect(controller.startCanary(canaryRequest)).resolves.toEqual({
      status: "canary",
      traffic_percent: 10,
    });
    await expect(controller.rollbackVersion(rollbackRequest)).resolves.toEqual({
      status: "rolled_back",
      active_version_id: rollbackRequest.target_version_id,
    });
  });

  it.each([
    ["DeploymentValidationError", 3],
    ["DeploymentNotFoundError", 5],
    ["DeploymentStateTransitionError", 9],
    ["DeploymentConcurrencyError", 10],
  ] as const)("maps %s to gRPC status %s", async (name, code) => {
    const failing = handler();
    failing.promoteVersion = vi.fn(async () => {
      throw new NamedDeploymentError(name, "safe lifecycle error");
    });
    const controller = new DeployctlGrpcController(failing);

    await expect(controller.promoteVersion(promoteRequest)).rejects.toMatchObject({
      error: { code, message: "safe lifecycle error" },
    });
  });

  it("hides unexpected internals behind a stable INTERNAL response", async () => {
    const failing = handler();
    failing.startCanary = vi.fn(async () => {
      throw new Error("database topology and credential details");
    });
    const controller = new DeployctlGrpcController(failing);

    await expect(controller.startCanary(canaryRequest)).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Workflow canary could not be started",
      },
    });
  });
});
