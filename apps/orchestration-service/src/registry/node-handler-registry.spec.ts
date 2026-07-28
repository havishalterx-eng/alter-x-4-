import { createMockQueueProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { MergeHandler } from "./handlers/merge.handler";
import {
  NodeHandlerRegistry,
  NodeTypeNotImplementedError,
  UnknownNodeTypeError,
  createRuntimeNodeHandlerRegistry,
} from "./node-handler-registry";

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const CREDENTIAL_REF = `/alter/prod/tenant/${TENANT_ID}/integration/search/access-token`;

function runtimeRegistry(toolInvoke = vi.fn(async () => ({
  output_json: JSON.stringify({ results: [] }),
  audit_id: "aud_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
}))) {
  return createRuntimeNodeHandlerRegistry({
    modelGateway: {
      invoke: async () => ({
        output_json: "{}",
        usage_json: "{}",
        resolved_capability: "test",
      }),
    },
    toolGateway: { invoke: toolInvoke },
    queueProvider: createMockQueueProvider(),
  });
}

describe("NodeHandlerRegistry", () => {
  it("dispatches to the registered handler for a known, implemented type", async () => {
    const registry = new NodeHandlerRegistry([new MergeHandler()]);

    const result = await registry.execute("Merge", {
      config: {},
      inputs: { node_a: { x: 1 } },
    });

    expect(result.output).toEqual({ x: 1 });
  });

  it("throws NodeTypeNotImplementedError for a known but unregistered type", async () => {
    const registry = new NodeHandlerRegistry([new MergeHandler()]);

    await expect(
      registry.execute("Synthesis", { config: {}, inputs: {} }),
    ).rejects.toThrow(NodeTypeNotImplementedError);
  });

  it("throws UnknownNodeTypeError for a type outside the 11-type vocabulary", async () => {
    const registry = new NodeHandlerRegistry([new MergeHandler()]);

    await expect(
      registry.execute("NotAType", { config: {}, inputs: {} }),
    ).rejects.toThrow(UnknownNodeTypeError);
  });

  it("runtime composition dispatches ToolCall through Tool Gateway", async () => {
    const invoke = vi.fn(async () => ({
      output_json: JSON.stringify({ results: [{ title: "AlterX" }] }),
      audit_id: "aud_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
    }));

    const result = await runtimeRegistry(invoke).execute("ToolCall", {
      config: {
        tool_name: "search.web",
        arguments: { query: "AlterX" },
        credential_ref: CREDENTIAL_REF,
      },
      inputs: {},
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(result.output).toEqual({ results: [{ title: "AlterX" }] });
  });

  it("runtime composition registers the explicit HumanApproval stub", async () => {
    await expect(
      runtimeRegistry().execute("HumanApproval", { config: {}, inputs: {} }),
    ).resolves.toMatchObject({
      output: {
        stub: true,
        pending: false,
        code: "approval_not_implemented",
      },
    });
  });
});
