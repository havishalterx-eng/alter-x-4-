import { createExecutorActivities, type BlackboardHandlerClient, type NodeExecutionHandler } from "@alterx/adapters";
import { createExecutorTestHarness, type ExecutorTestHarness } from "@alterx/adapters/testing";
import type { ToolgwInvokeToolRequest } from "@alterx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileTaskSkeletonToDag } from "../../compiler/dag-builder";
import type { NodeHandler } from "../handler";
import { GateHandler } from "./gate.handler";
import { LlmTaskHandler } from "./llmtask.handler";
import { ToolCallHandler } from "./toolcall.handler";

/**
 * A planned llm step's output reaching a planned tool call's arguments, on a
 * real Temporal executor: the real compiler (which puts a verification gate
 * between the two), the real executor workflow and activities, and the real
 * LLMTask, Gate and ToolCall handlers. Only the gateways, the verification
 * results and the Blackboard are stand-ins.
 */
const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const CREDENTIAL_REF = `/alter/prod/tenant/${TENANT_ID}/integration/email/access-token`;

const toolCalls: ToolgwInvokeToolRequest[] = [];

const handlers: Record<string, NodeHandler> = {
  LLMTask: new LlmTaskHandler({
    async invoke() {
      return {
        output_json: JSON.stringify({ subject: "Weekly report", body: "All green." }),
        usage_json: "{}",
        resolved_capability: "",
        estimated_cost_usd: "",
        cache_hit: false,
      };
    },
  }),
  Gate: new GateHandler({
    async findForSourceNode() {
      return [
        { gateType: "quality", verdict: "pass", score: 0.9, threshold: 0.7, details: {} },
        { gateType: "safety", verdict: "pass", score: null, threshold: null, details: { severity: "low" } },
      ];
    },
  }),
  ToolCall: new ToolCallHandler({
    async invoke(request) {
      toolCalls.push(request);
      return { output_json: JSON.stringify({ sent: true }), audit_id: "aud_018f4d6e-2b4a-7a3e-8c1a-1234567890ab" };
    },
  }),
};

const nodeexec: NodeExecutionHandler = {
  async executeNode(request) {
    const result = await handlers[request.node_type]!.execute({
      config: JSON.parse(request.config_json) as Record<string, unknown>,
      inputs: JSON.parse(request.inputs_json) as Record<string, Record<string, unknown>>,
      tenant_id: request.tenant_id,
      run_id: request.run_id,
      node_execution_id: request.node_execution_id,
    });
    return { output_json: JSON.stringify(result.output), metadata_json: JSON.stringify(result.metadata ?? {}) };
  },
  async finalizeRun(request) {
    return { status: request.status, ended_at: "" };
  },
  async finalizeApprovalNode() {
    throw new Error("this DAG has no approval node");
  },
};

function blackboard(): BlackboardHandlerClient {
  const values = new Map<string, string>();
  return {
    async readValue(request) {
      const value = values.get(`${request.run_id}/${request.key}`);
      return value === undefined ? { found: false, value_json: "" } : { found: true, value_json: value };
    },
    async writeValue(request) {
      values.set(`${request.run_id}/${request.key}`, request.value_json);
      return {};
    },
  };
}

describe.sequential("tool arguments referencing upstream output on a real executor", () => {
  let harness: ExecutorTestHarness;

  beforeAll(async () => {
    harness = await createExecutorTestHarness("toolcall-references", createExecutorActivities(nodeexec, blackboard()));
  }, 180_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  it("sends the email an llm step drafted", { timeout: 120_000 }, async () => {
    const dag = compileTaskSkeletonToDag(
      {
        version: "1",
        entry_point: "draft",
        nodes: [
          { key: "draft", type: "llm", config: { model_alias: "STANDARD", prompt: "Draft the weekly report email." }, depends_on: [] },
          {
            key: "send",
            type: "tool",
            config: {
              tool_name: "email.send",
              credential_ref: CREDENTIAL_REF,
              arguments: {
                to: "ops@example.com",
                subject: { $from: "draft", path: "subject" },
                body: { $from: "draft", path: "body" },
              },
            },
            depends_on: ["draft"],
          },
        ],
      },
      "v1",
    );

    const result = await harness.run("toolcall-references-email", {
      tenantId: TENANT_ID,
      runId: RUN_ID,
      compiledDagJson: JSON.stringify(dag),
    });

    expect(result.outputs["send"]).toEqual({ sent: true });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.tool_name).toBe("email.send");
    expect(JSON.parse(toolCalls[0]!.input_json)).toEqual({
      to: "ops@example.com",
      subject: "Weekly report",
      body: "All green.",
    });
  });
});
