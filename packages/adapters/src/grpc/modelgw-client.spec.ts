import { describe, expect, it, vi } from "vitest";

import type {
  ModelgwInvokeRequest,
  ModelgwInvokeResponse,
  ModelgwStreamRequest,
  ModelgwStreamResponse,
} from "@alterx/contracts";
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

  it("forwards server-streamed deltas in order with a bounded deadline", async () => {
    let deadline: Date | undefined;
    const responses: readonly ModelgwStreamResponse[] = [
      { sequence: 1, delta: "hello", final: false },
      { sequence: 2, delta: " world", final: false },
      { sequence: 3, delta: "", final: true },
    ];
    const grpcClient = {
      invoke: vi.fn(),
      stream: vi.fn(
        (
          _request: ModelgwStreamRequest,
          options: { readonly deadline: Date },
        ) => {
          deadline = options.deadline;
          return {
            cancel: vi.fn(),
            async *[Symbol.asyncIterator]() {
              yield* responses;
            },
          };
        },
      ),
    };
    const client = new ModelGatewayClient(
      {
        address: "localhost:1234",
        protoPath: "unused",
        timeoutMs: 500,
        streamTimeoutMs: 1_500,
      },
      grpcClient as never,
    );

    const received: ModelgwStreamResponse[] = [];
    for await (const response of client.stream(REQUEST)) {
      received.push(response);
    }

    expect(received).toEqual(responses);
    expect(grpcClient.stream).toHaveBeenCalledWith(
      REQUEST,
      expect.objectContaining({ deadline: expect.any(Date) }),
    );
    expect(deadline?.getTime()).toBeGreaterThan(Date.now() + 1_000);
  });

  it("cancels the upstream gRPC call when its consumer stops early", async () => {
    const cancel = vi.fn();
    const grpcClient = {
      invoke: vi.fn(),
      stream: vi.fn(() => ({
        cancel,
        async *[Symbol.asyncIterator]() {
          yield { sequence: 1, delta: "first", final: false };
          yield { sequence: 2, delta: "second", final: false };
        },
      })),
    };
    const client = new ModelGatewayClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    const iterator = client.stream(REQUEST)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await iterator.return?.();

    expect(cancel).toHaveBeenCalledOnce();
  });
});
