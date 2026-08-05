import { describe, expect, it, vi } from "vitest";

import { ProvisioningServiceGrpcHandler } from "./provisioning.grpc-handler";

const request = {
  tenant_id: "ten_1",
  run_id: "run_1",
  project_id: "prj_1",
  cycle_id: "cycle_1",
  template_id: "node",
  environment_refs: { API_KEY: "secret/api-key" },
  scaffold: [{ path: "package.json", content: "{}" }],
};

describe("ProvisioningServiceGrpcHandler", () => {
  it("maps Provision RPC input and response to the domain service", async () => {
    const service = {
      provision: vi.fn(async () => ({
        sessionId: "ses_1",
        projectDirectory: "/workspace/prj_1",
        reused: false,
      })),
      closeCycle: vi.fn(),
    };
    const handler = new ProvisioningServiceGrpcHandler(service as never);

    await expect(handler.provision(request)).resolves.toEqual({
      session_id: "ses_1",
      project_directory: "/workspace/prj_1",
      reused: false,
    });
    expect(service.provision).toHaveBeenCalledWith({
      tenantId: "ten_1",
      runId: "run_1",
      projectId: "prj_1",
      cycleId: "cycle_1",
      templateId: "node",
      environmentRefs: { API_KEY: "secret/api-key" },
      scaffold: [{ path: "package.json", content: "{}" }],
    });
  });

  it("closes the requested provisioned cycle", async () => {
    const service = { provision: vi.fn(), closeCycle: vi.fn(async () => undefined) };
    const handler = new ProvisioningServiceGrpcHandler(service as never);

    await expect(handler.closeCycle(request)).resolves.toEqual({ closed: true });
    expect(service.closeCycle).toHaveBeenCalledWith(
      "ten_1",
      "run_1",
      "prj_1",
      "cycle_1",
    );
  });
});
