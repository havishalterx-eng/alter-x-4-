import { describe, expect, it, vi } from "vitest";

import type { RunsGetRunWorkspaceRequest, RunsGetRunWorkspaceResponse } from "@alterx/contracts";
import { RunsClient } from "./runs-client";

function fakeGrpcClient(
  handler: (
    request: RunsGetRunWorkspaceRequest,
  ) => { error: Error | null; response?: RunsGetRunWorkspaceResponse },
) {
  return {
    getRunWorkspace: vi.fn(
      (
        request: RunsGetRunWorkspaceRequest,
        _options: unknown,
        callback: (error: Error | null, response?: RunsGetRunWorkspaceResponse) => void,
      ) => {
        const { error, response } = handler(request);
        callback(error, response);
      },
    ),
  };
}

const REQUEST: RunsGetRunWorkspaceRequest = {
  tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
  run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
};

describe("RunsClient", () => {
  it("resolves with the Run Lookup Service's real response", async () => {
    const grpcClient = fakeGrpcClient(() => ({
      error: null,
      response: { workspace_id: "ws_018f47a2-7b11-7b11-8a11-1234567890ab" },
    }));
    const client = new RunsClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    const response = await client.getRunWorkspace(REQUEST);

    expect(response.workspace_id).toBe("ws_018f47a2-7b11-7b11-8a11-1234567890ab");
    expect(grpcClient.getRunWorkspace).toHaveBeenCalledWith(
      REQUEST,
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
  });

  it("rejects when the gRPC call errors", async () => {
    const grpcClient = fakeGrpcClient(() => ({ error: new Error("unavailable") }));
    const client = new RunsClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.getRunWorkspace(REQUEST)).rejects.toThrow("unavailable");
  });

  it("rejects on an empty response", async () => {
    const grpcClient = fakeGrpcClient(() => ({ error: null }));
    const client = new RunsClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.getRunWorkspace(REQUEST)).rejects.toThrow(
      "Run Lookup Service returned an empty response",
    );
  });
});
