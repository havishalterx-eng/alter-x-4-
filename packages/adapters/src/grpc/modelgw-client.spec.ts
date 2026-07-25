import { describe, expect, it, vi } from "vitest";

import type { ModelgwInvokeRequest, ModelgwInvokeResponse } from "@alterx/contracts";
import { ModelGatewayClient } from "./modelgw-client";

function fakeGrpcClient(
  handler: (
    request: ModelgwInvokeRequest,
  ) => { error: Error | null; response?: ModelgwInvokeResponse },
) {
  return {
    invoke: vi.fn(
      (
        request: ModelgwInvokeRequest,
        _options: unknown,
        callback: (
          error: Error | null,
          response?: ModelgwInvokeResponse,
        ) => void,
      ) => {
        const { error, response } = handler(request);
        callback(error, response);
      },
    ),
  };
}

const REQUEST: ModelgwInvokeRequest = {
  tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
  run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
  node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
  model_alias: "FAST",
  input_json: JSON.stringify({ utterance: "hello" }),
};

describe("ModelGatewayClient", () => {
  it("resolves with the Model Gateway's real response", async () => {
    const grpcClient = fakeGrpcClient(() => ({
      error: null,
      response: {
        output_json: JSON.stringify({ intent: "answer" }),
        usage_json: JSON.stringify({ totalTokens: 12 }),
        resolved_capability: "FAST:aws-bedrock",
      },
    }));
    const client = new ModelGatewayClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    const response = await client.invoke(REQUEST);

    expect(response.resolved_capability).toBe("FAST:aws-bedrock");
    expect(grpcClient.invoke).toHaveBeenCalledWith(
      REQUEST,
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
  });

  it("rejects when the gRPC call errors", async () => {
    const grpcClient = fakeGrpcClient(() => ({
      error: new Error("unavailable"),
    }));
    const client = new ModelGatewayClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.invoke(REQUEST)).rejects.toThrow("unavailable");
  });

  it("rejects when the response is empty", async () => {
    const grpcClient = fakeGrpcClient(() => ({ error: null }));
    const client = new ModelGatewayClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.invoke(REQUEST)).rejects.toThrow("empty response");
  });
});
