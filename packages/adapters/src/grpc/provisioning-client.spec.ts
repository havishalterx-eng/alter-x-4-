import { status } from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";

import type { ProvisioningProvisionRequest } from "@alterx/contracts";
import { ProvisioningClient } from "./provisioning-client";

type ProvisionCallback = (
  error: Error | null,
  response?: {
    readonly session_id: string;
    readonly project_directory: string;
    readonly reused: boolean;
  },
) => void;

type CloseCycleCallback = (
  error: Error | null,
  response?: { readonly closed: boolean },
) => void;

const request: ProvisioningProvisionRequest = {
  tenant_id: "ten_1",
  run_id: "run_1",
  project_id: "prj_1",
  cycle_id: "cycle_1",
  template_id: "node",
  environment_refs: {},
  scaffold: [],
};

describe("ProvisioningClient", () => {
  it("calls the real Provision RPC with a deadline", async () => {
    const grpcClient = {
      provision: vi.fn(
        (_request: unknown, _options: unknown, callback: ProvisionCallback) =>
          callback(null, {
            session_id: "ses_1",
            project_directory: "/workspace/prj_1",
            reused: false,
          }),
      ),
    };
    const client = new ProvisioningClient(
      { address: "localhost:50055", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.provision(request)).resolves.toEqual({
      session_id: "ses_1",
      project_directory: "/workspace/prj_1",
      reused: false,
    });
    expect(grpcClient.provision).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
  });

  it("marks unavailable Provisioning Service errors as retryable", async () => {
    const grpcClient = {
      closeCycle: vi.fn(
        (_request: unknown, _options: unknown, callback: CloseCycleCallback) =>
          callback(
            Object.assign(new Error("unavailable"), {
              code: status.UNAVAILABLE,
            }),
          ),
      ),
    };
    const client = new ProvisioningClient(
      { address: "localhost:50055", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.closeCycle(request)).rejects.toMatchObject({
      name: "ProvisioningClientError",
      retryable: true,
    });
  });
});
