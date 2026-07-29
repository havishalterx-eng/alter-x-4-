import { describe, expect, it } from "vitest";

import { NodeHandlerValidationError } from "../handler";
import { GateHandler } from "./gate.handler";
import type { VerificationGateReader } from "../verification-gate-reader";

describe("GateHandler", () => {
  it("has nodeType Gate", () => {
    expect(new GateHandler().nodeType).toBe("Gate");
  });

  it("reports active successors whose condition evaluates true", async () => {
    const handler = new GateHandler();

    const result = await handler.execute({
      config: {
        conditions: {
          node_success: "inputs.check.status == 'ok'",
          node_failure: "inputs.check.status != 'ok'",
        },
      },
      inputs: { check: { status: "ok" } },
    });

    expect(result.output).toEqual({
      activeSuccessors: ["node_success"],
      evaluations: { node_success: true, node_failure: false },
    });
  });

  it("rejects a missing config.conditions", async () => {
    const handler = new GateHandler();

    await expect(
      handler.execute({ config: {}, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects a non-string condition", async () => {
    const handler = new GateHandler();

    await expect(
      handler.execute({
        config: { conditions: { node_a: 123 } },
        inputs: {},
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects an invalid CEL-subset expression", async () => {
    const handler = new GateHandler();

    await expect(
      handler.execute({
        config: { conditions: { node_a: "inputs.a == @weird" } },
        inputs: {},
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("can activate multiple successors at once", async () => {
    const handler = new GateHandler();

    const result = await handler.execute({
      config: {
        conditions: { node_a: "true", node_b: "true" },
      },
      inputs: {},
    });

    expect(result.output["activeSuccessors"]).toEqual(["node_a", "node_b"]);
  });

  it("blocks absent verification results instead of allowing an external action", async () => {
    const reader: VerificationGateReader = { findForSourceNode: async () => [] };
    const result = await new GateHandler(reader).execute(verificationContext());
    expect(result.output).toMatchObject({ verification_status: "blocked_pending_recovery", activeSuccessors: [], reason: "verification_result_missing" });
    expect(result.metadata).toEqual({ execution_status: "blocked_pending_recovery" });
  });

  it("blocks failed quality or critical safety verification", async () => {
    const reader: VerificationGateReader = { findForSourceNode: async () => [
      { gateType: "quality", verdict: "fail", score: 0.1, threshold: 0.7, details: {} },
      { gateType: "safety", verdict: "fail", score: null, threshold: null, details: { severity: "critical" } },
    ] };
    const result = await new GateHandler(reader).execute(verificationContext());
    expect(result.output).toMatchObject({ verification_status: "blocked_pending_recovery", activeSuccessors: [] });
  });

  it("allows clean quality and noncritical safety verification", async () => {
    const reader: VerificationGateReader = { findForSourceNode: async () => [
      { gateType: "quality", verdict: "pass", score: 0.9, threshold: 0.7, details: {} },
      { gateType: "safety", verdict: "warn", score: null, threshold: null, details: { severity: "low" } },
    ] };
    const result = await new GateHandler(reader).execute(verificationContext());
    expect(result.output).toMatchObject({ activeSuccessors: ["external_action"], verification_status: "passed" });
  });
});

function verificationContext() {
  return {
    config: { verification: { source_node_key: "reviewed_node", protected_node_key: "external_action" } },
    inputs: {},
    tenant_id: "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
    run_id: "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ac",
  };
}
