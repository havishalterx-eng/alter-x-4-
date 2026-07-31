import { describe, expect, it, vi } from "vitest";

import type { CostIngestCostEventRequest } from "@alterx/contracts";
import { CostGrpcController, type CostHandler } from "./cost-grpc-transport";

const REQUEST: CostIngestCostEventRequest = {
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  cost_event_id: "cst_018f47a5-7b2c-7d10-8f11-123456789abc",
  run_id: "run_018f47a5-7b2c-7d10-8f11-123456789abc",
  node_execution_id: "node_018f47a5-7b2c-7d10-8f11-123456789abc",
  provider_reference: "aws-bedrock",
  usage_json: JSON.stringify({ input_tokens: 10, output_tokens: 5 }),
  amount_json: JSON.stringify({ usd: 0.001, estimated: true }),
  source: "model_gateway",
  occurred_at: "2026-07-31T00:00:00.000Z",
};

class NamedCostError extends Error {
  constructor(name: string) {
    super("safe ingestion error");
    this.name = name;
  }
}

function handler(): CostHandler {
  return {
    ingestCostEvent: vi.fn(async () => ({ accepted: true })),
  };
}

describe("CostGrpcController", () => {
  it("delegates the locked IngestCostEvent request/response shape", async () => {
    const costHandler = handler();
    const controller = new CostGrpcController(costHandler);
    await expect(controller.ingestCostEvent(REQUEST)).resolves.toEqual({
      accepted: true,
    });
    expect(costHandler.ingestCostEvent).toHaveBeenCalledWith(REQUEST);
  });

  it.each([
    ["CostValidationError", 3],
    ["CostUnrecognizedSourceError", 3],
  ] as const)("maps %s to gRPC status %s", async (name, code) => {
    const failing = handler();
    failing.ingestCostEvent = vi.fn(async () => {
      throw new NamedCostError(name);
    });
    const controller = new CostGrpcController(failing);
    await expect(controller.ingestCostEvent(REQUEST)).rejects.toMatchObject({
      error: { code },
    });
  });

  it("hides unexpected internal details", async () => {
    const failing = handler();
    failing.ingestCostEvent = vi.fn(async () => {
      throw new Error("database credential leaked if propagated");
    });
    const controller = new CostGrpcController(failing);
    await expect(controller.ingestCostEvent(REQUEST)).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Cost event ingestion could not be completed",
      },
    });
  });
});
