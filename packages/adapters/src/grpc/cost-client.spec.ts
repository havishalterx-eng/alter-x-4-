import { describe, expect, it, vi } from "vitest";

import type { CostIngestCostEventRequest, CostIngestCostEventResponse } from "@alterx/contracts";
import { CostClient } from "./cost-client";

function fakeGrpcClient(
  handler: (
    request: CostIngestCostEventRequest,
  ) => { error: Error | null; response?: CostIngestCostEventResponse },
) {
  return {
    ingestCostEvent: vi.fn(
      (
        request: CostIngestCostEventRequest,
        _options: unknown,
        callback: (error: Error | null, response?: CostIngestCostEventResponse) => void,
      ) => {
        const { error, response } = handler(request);
        callback(error, response);
      },
    ),
  };
}

const REQUEST: CostIngestCostEventRequest = {
  tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
  cost_event_id: "cst_018f47a2-7b11-7b11-8a11-1234567890ab",
  run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
  node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
  provider_reference: "aws-bedrock",
  usage_json: "{}",
  amount_json: "{}",
  source: "model_gateway",
  occurred_at: "2026-07-31T00:00:00.000Z",
};

describe("CostClient", () => {
  it("resolves with the Cost Service's real response", async () => {
    const grpcClient = fakeGrpcClient(() => ({ error: null, response: { accepted: true } }));
    const client = new CostClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.ingestCostEvent(REQUEST)).resolves.toEqual({ accepted: true });
    expect(grpcClient.ingestCostEvent).toHaveBeenCalledWith(
      REQUEST,
      expect.objectContaining({ deadline: expect.any(Date) }),
      expect.any(Function),
    );
  });

  it("rejects when the gRPC call errors", async () => {
    const grpcClient = fakeGrpcClient(() => ({ error: new Error("unavailable") }));
    const client = new CostClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.ingestCostEvent(REQUEST)).rejects.toThrow("unavailable");
  });

  it("rejects on an empty response", async () => {
    const grpcClient = fakeGrpcClient(() => ({ error: null }));
    const client = new CostClient(
      { address: "localhost:1234", protoPath: "unused" },
      grpcClient as never,
    );

    await expect(client.ingestCostEvent(REQUEST)).rejects.toThrow(
      "Cost Service returned an empty response",
    );
  });
});
