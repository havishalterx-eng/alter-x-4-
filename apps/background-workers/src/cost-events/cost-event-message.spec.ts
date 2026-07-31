import { describe, expect, it } from "vitest";

import { parseCostEventMessage } from "./cost-event-message";

const VALID = {
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

describe("parseCostEventMessage", () => {
  it("passes through a real, fully-shaped message", () => {
    expect(parseCostEventMessage(VALID)).toEqual(VALID);
  });

  it("rejects a non-object message", () => {
    expect(parseCostEventMessage("not an object")).toBeUndefined();
    expect(parseCostEventMessage(42)).toBeUndefined();
    expect(parseCostEventMessage(null as never)).toBeUndefined();
    expect(parseCostEventMessage([VALID] as never)).toBeUndefined();
  });

  it.each(Object.keys(VALID) as (keyof typeof VALID)[])(
    "rejects a message missing %s",
    (field) => {
      const rest = Object.fromEntries(
        Object.entries(VALID).filter(([key]) => key !== field),
      );
      expect(parseCostEventMessage(rest)).toBeUndefined();
    },
  );

  it("rejects a message where a required field is the wrong type", () => {
    expect(parseCostEventMessage({ ...VALID, tenant_id: 123 } as never)).toBeUndefined();
  });
});
