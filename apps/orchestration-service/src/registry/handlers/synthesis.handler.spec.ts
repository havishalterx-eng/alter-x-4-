import type { ModelGatewayHandler } from "@alterx/adapters";
import type { ModelgwInvokeRequest, ModelgwInvokeResponse } from "@alterx/contracts";
import { ModelGatewayInvalidResponseError } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { NodeHandlerValidationError } from "../handler";
import type { VerificationGateReader, VerificationResultRecord } from "../verification-gate-reader";
import { SynthesisHandler } from "./synthesis.handler";

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function fakeGateway(
  invoke: (request: ModelgwInvokeRequest) => Promise<ModelgwInvokeResponse>,
): ModelGatewayHandler {
  return { invoke };
}

function readerFor(
  byKey: Record<string, readonly VerificationResultRecord[]>,
): VerificationGateReader {
  return {
    findForSourceNode: async ({ sourceNodeKey }) => byKey[sourceNodeKey] ?? [],
  };
}

const PASS: VerificationResultRecord = { gateType: "quality", verdict: "pass", score: 0.9, threshold: 0.7, details: {} };
const FAIL: VerificationResultRecord = { gateType: "quality", verdict: "fail", score: 0.2, threshold: 0.7, details: {} };
const SAFE: VerificationResultRecord = { gateType: "safety", verdict: "pass", score: null, threshold: null, details: { severity: "low" } };
const CRITICAL: VerificationResultRecord = { gateType: "safety", verdict: "fail", score: null, threshold: null, details: { severity: "critical" } };

function baseContext(inputs: Record<string, Record<string, unknown>>) {
  return {
    config: {},
    inputs,
    tenant_id: TENANT_ID,
    run_id: RUN_ID,
    node_execution_id: NODE_EXECUTION_ID,
  };
}

describe("SynthesisHandler", () => {
  it("has nodeType Synthesis", () => {
    const handler = new SynthesisHandler(fakeGateway(vi.fn()), readerFor({}));
    expect(handler.nodeType).toBe("Synthesis");
  });

  it("rejects a missing run context (tenant_id/run_id/node_execution_id)", async () => {
    const handler = new SynthesisHandler(fakeGateway(vi.fn()), readerFor({}));
    await expect(
      handler.execute({ config: {}, inputs: { a: {} } }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects zero upstream inputs", async () => {
    const handler = new SynthesisHandler(fakeGateway(vi.fn()), readerFor({}));
    await expect(handler.execute(baseContext({}))).rejects.toThrow(
      NodeHandlerValidationError,
    );
  });

  it("merges only verified inputs via the Model Gateway on ADVANCED tier", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: JSON.stringify({ summary: "final answer" }),
      usage_json: JSON.stringify({ tokens: 100 }),
      resolved_capability: "anthropic.claude-opus-4.8",
    });
    const reader = readerFor({
      node_a: [PASS, SAFE],
      node_b: [PASS, SAFE],
    });
    const handler = new SynthesisHandler(fakeGateway(invoke), reader);

    const result = await handler.execute(
      baseContext({ node_a: { x: 1 }, node_b: { y: 2 } }),
    );

    expect(invoke).toHaveBeenCalledWith({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      model_alias: "ADVANCED",
      input_json: JSON.stringify({
        task: "synthesize_deliverable",
        inputs: { node_a: { x: 1 }, node_b: { y: 2 } },
      }),
    });
    expect(result.output).toEqual({
      deliverable: { summary: "final answer" },
      degraded: false,
      gaps: [],
    });
    expect(result.metadata).toEqual({
      usage: { tokens: 100 },
      resolved_capability: "anthropic.claude-opus-4.8",
    });
  });

  it("excludes a failed-quality input and flags it as an honest gap", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: JSON.stringify({ summary: "partial" }),
      usage_json: "{}",
      resolved_capability: "x",
    });
    const reader = readerFor({
      node_a: [PASS, SAFE],
      node_b: [FAIL, SAFE],
    });
    const handler = new SynthesisHandler(fakeGateway(invoke), reader);

    const result = await handler.execute(
      baseContext({ node_a: { x: 1 }, node_b: { y: 2 } }),
    );

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        input_json: JSON.stringify({
          task: "synthesize_deliverable",
          inputs: { node_a: { x: 1 } },
        }),
      }),
    );
    expect(result.output).toEqual({
      deliverable: { summary: "partial" },
      degraded: true,
      gaps: [{ source_node_key: "node_b", reason: "quality_verification_failed" }],
    });
  });

  it("excludes a critical-safety input as a gap even when quality passed", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: JSON.stringify({ summary: "partial" }),
      usage_json: "{}",
      resolved_capability: "x",
    });
    const reader = readerFor({
      node_a: [PASS, SAFE],
      node_b: [PASS, CRITICAL],
    });
    const handler = new SynthesisHandler(fakeGateway(invoke), reader);

    const result = await handler.execute(
      baseContext({ node_a: { x: 1 }, node_b: { y: 2 } }),
    );

    expect(result.output).toMatchObject({
      degraded: true,
      gaps: [{ source_node_key: "node_b", reason: "safety_critical" }],
    });
  });

  it("treats a missing verification result as a gap, not a silent pass", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: JSON.stringify({ summary: "partial" }),
      usage_json: "{}",
      resolved_capability: "x",
    });
    const reader = readerFor({ node_a: [PASS, SAFE] });
    const handler = new SynthesisHandler(fakeGateway(invoke), reader);

    const result = await handler.execute(
      baseContext({ node_a: { x: 1 }, node_b: { y: 2 } }),
    );

    expect(result.output).toMatchObject({
      degraded: true,
      gaps: [{ source_node_key: "node_b", reason: "verification_result_missing" }],
    });
  });

  it("never calls the Model Gateway and reports blocked_pending_recovery when nothing verified", async () => {
    const invoke = vi.fn();
    const reader = readerFor({ node_a: [FAIL], node_b: [] });
    const handler = new SynthesisHandler(fakeGateway(invoke), reader);

    const result = await handler.execute(
      baseContext({ node_a: { x: 1 }, node_b: { y: 2 } }),
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(result.output).toEqual({
      synthesized: false,
      gaps: [
        { source_node_key: "node_a", reason: "quality_verification_failed" },
        { source_node_key: "node_b", reason: "verification_result_missing" },
      ],
      reason: "no_verified_inputs",
    });
    expect(result.metadata).toEqual({ execution_status: "blocked_pending_recovery" });
  });

  it("fails closed on malformed output_json", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: "{not json",
      usage_json: "{}",
      resolved_capability: "x",
    });
    const reader = readerFor({ node_a: [PASS, SAFE] });
    const handler = new SynthesisHandler(fakeGateway(invoke), reader);

    await expect(
      handler.execute(baseContext({ node_a: { x: 1 } })),
    ).rejects.toThrow(ModelGatewayInvalidResponseError);
  });

  it("fails closed when output_json parses to a non-object", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: "[1,2,3]",
      usage_json: "{}",
      resolved_capability: "x",
    });
    const reader = readerFor({ node_a: [PASS, SAFE] });
    const handler = new SynthesisHandler(fakeGateway(invoke), reader);

    await expect(
      handler.execute(baseContext({ node_a: { x: 1 } })),
    ).rejects.toThrow(ModelGatewayInvalidResponseError);
  });

  it("fails open (empty usage) on malformed usage_json without losing the deliverable", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: JSON.stringify({ summary: "ok" }),
      usage_json: "{not json",
      resolved_capability: "x",
    });
    const reader = readerFor({ node_a: [PASS, SAFE] });
    const handler = new SynthesisHandler(fakeGateway(invoke), reader);

    const result = await handler.execute(baseContext({ node_a: { x: 1 } }));

    expect(result.output).toEqual({
      deliverable: { summary: "ok" },
      degraded: false,
      gaps: [],
    });
    expect(result.metadata).toEqual({ usage: {}, resolved_capability: "x" });
  });
});
