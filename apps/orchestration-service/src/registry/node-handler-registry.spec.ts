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
        cache_hit: false,
      }),
    },
    memoryService: {
      proposeWriteback: async () => ({ memory_id: "mem_1", candidate_json: "{}" }),
    },
    toolGateway: { invoke: toolInvoke },
    sandboxService: {
      execute: async () => ({
        exit_code: 0,
        stdout_artifact_id: "",
        stderr_artifact_id: "",
        stdout: "",
        stderr: "",
      }),
    },
    queueProvider: createMockQueueProvider(),
    approvalRequester: {
      requestApproval: async () => ({
        approvalId: "apr_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
        expiryAt: "2026-07-30T00:00:00.000Z",
      }),
    },
    verificationGateReader: { findForSourceNode: async () => [] },
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

  it("runtime composition dispatches Synthesis through Model Gateway and the verification reader", async () => {
    const invoke = vi.fn(async () => ({
      output_json: JSON.stringify({ summary: "merged" }),
      usage_json: "{}",
      resolved_capability: "test",
      cache_hit: false,
    }));
    const registry = createRuntimeNodeHandlerRegistry({
      modelGateway: { invoke },
      memoryService: {
        proposeWriteback: async () => ({ memory_id: "mem_1", candidate_json: "{}" }),
      },
      toolGateway: { invoke: vi.fn() },
      sandboxService: {
        execute: async () => ({
          exit_code: 0,
          stdout_artifact_id: "",
          stderr_artifact_id: "",
          stdout: "",
          stderr: "",
        }),
      },
      queueProvider: createMockQueueProvider(),
      approvalRequester: {
        requestApproval: async () => ({
          approvalId: "apr_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
          expiryAt: "2026-07-30T00:00:00.000Z",
        }),
      },
      verificationGateReader: {
        findForSourceNode: async () => [
          { gateType: "quality", verdict: "pass", score: 0.9, threshold: 0.7, details: {} },
        ],
      },
    });

    const result = await registry.execute("Synthesis", {
      config: {},
      inputs: { node_a: { x: 1 } },
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(result.output).toEqual({
      deliverable: { summary: "merged" },
      degraded: false,
      gaps: [],
    });
  });

  it("runtime composition registers the real HumanApproval handler", async () => {
    await expect(
      runtimeRegistry().execute("HumanApproval", {
        config: {},
        inputs: {},
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
      }),
    ).resolves.toMatchObject({
      output: {
        approval_id: "apr_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
        status: "pending",
      },
      metadata: { execution_status: "pending_approval" },
    });
  });
});
