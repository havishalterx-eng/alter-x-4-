import type { ModelGatewayHandler } from "@alterx/adapters";
import type { ModelgwInvokeRequest, ModelgwInvokeResponse } from "@alterx/contracts";
import { ModelGatewayInvalidResponseError } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { NodeHandlerValidationError } from "../handler";
import { LlmTaskHandler } from "./llmtask.handler";

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function fakeGateway(
  invoke: (request: ModelgwInvokeRequest) => Promise<ModelgwInvokeResponse>,
): ModelGatewayHandler {
  return { invoke };
}

describe("LlmTaskHandler", () => {
  it("has nodeType LLMTask", () => {
    const handler = new LlmTaskHandler(fakeGateway(vi.fn()));
    expect(handler.nodeType).toBe("LLMTask");
  });

  it("invokes the Model Gateway with the declared alias and run identifiers", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: JSON.stringify({ text: "hello" }),
      usage_json: JSON.stringify({ tokens: 42 }),
      resolved_capability: "anthropic.claude-sonnet-5",
    });
    const handler = new LlmTaskHandler(fakeGateway(invoke));

    const result = await handler.execute({
      config: { model_alias: "ADVANCED", prompt: "summarize this" },
      inputs: { node_a: { text: "upstream text" } },
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
    });

    expect(invoke).toHaveBeenCalledWith({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      model_alias: "ADVANCED",
      input_json: JSON.stringify({
        prompt: "summarize this",
        inputs: { node_a: { text: "upstream text" } },
      }),
    });
    expect(result.output).toEqual({ text: "hello" });
    expect(result.metadata).toEqual({
      usage: { tokens: 42 },
      resolved_capability: "anthropic.claude-sonnet-5",
    });
  });

  it("forwards incremental model deltas before assembling the final output", async () => {
    const onModelDelta = vi.fn().mockResolvedValue(undefined);
    const stream = vi.fn(async function* () {
      yield { delta: '{"text":"hel', sequence: 1, final: false };
      yield { delta: 'lo"}', sequence: 2, final: true };
    });
    const handler = new LlmTaskHandler({
      invoke: vi.fn(),
      stream,
    } as ModelGatewayHandler & {
      stream(request: ModelgwInvokeRequest): AsyncIterable<{
        delta: string;
        sequence: number;
        final: boolean;
      }>;
    });

    const result = await handler.execute({
      config: { model_alias: "ADVANCED", prompt: "summarize this" },
      inputs: {},
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      on_model_delta: onModelDelta,
    });

    expect(stream).toHaveBeenCalledOnce();
    expect(onModelDelta.mock.calls).toEqual([
      ['{"text":"hel', 0, false],
      ['lo"}', 1, true],
    ]);
    expect(result.output).toEqual({ text: "hello" });
  });

  it("rejects a missing model_alias", async () => {
    const handler = new LlmTaskHandler(fakeGateway(vi.fn()));

    await expect(
      handler.execute({
        config: { prompt: "x" },
        inputs: {},
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects an unrecognised model_alias", async () => {
    const handler = new LlmTaskHandler(fakeGateway(vi.fn()));

    await expect(
      handler.execute({
        config: { model_alias: "SUPER_FAST", prompt: "x" },
        inputs: {},
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects a missing prompt", async () => {
    const handler = new LlmTaskHandler(fakeGateway(vi.fn()));

    await expect(
      handler.execute({
        config: { model_alias: "FAST" },
        inputs: {},
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects a missing run context (tenant_id/run_id/node_execution_id)", async () => {
    const handler = new LlmTaskHandler(fakeGateway(vi.fn()));

    await expect(
      handler.execute({ config: { model_alias: "FAST", prompt: "x" }, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("fails closed on malformed output_json", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: "{not json",
      usage_json: "{}",
      resolved_capability: "x",
    });
    const handler = new LlmTaskHandler(fakeGateway(invoke));

    await expect(
      handler.execute({
        config: { model_alias: "FAST", prompt: "x" },
        inputs: {},
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
      }),
    ).rejects.toThrow(ModelGatewayInvalidResponseError);
  });

  it("fails closed when output_json parses to a non-object", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: "[1,2,3]",
      usage_json: "{}",
      resolved_capability: "x",
    });
    const handler = new LlmTaskHandler(fakeGateway(invoke));

    await expect(
      handler.execute({
        config: { model_alias: "FAST", prompt: "x" },
        inputs: {},
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
      }),
    ).rejects.toThrow(ModelGatewayInvalidResponseError);
  });

  it("fails open (empty usage) on malformed usage_json without losing the output", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: JSON.stringify({ text: "ok" }),
      usage_json: "{not json",
      resolved_capability: "x",
    });
    const handler = new LlmTaskHandler(fakeGateway(invoke));

    const result = await handler.execute({
      config: { model_alias: "FAST", prompt: "x" },
      inputs: {},
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
    });

    expect(result.output).toEqual({ text: "ok" });
    expect(result.metadata).toEqual({ usage: {}, resolved_capability: "x" });
  });
});
