import { TestWorkflowEnvironment } from "@temporalio/testing";
import { createExecutorWorker, type ExecutorActivities } from "@alterx/adapters";
import type { CompiledDag } from "@alterx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileArchitectureToDag, type ArchitectureCompileInput } from "./architecture-dag-builder";
import { compileTaskSkeletonToDag } from "./dag-builder";

/**
 * Both compilers' real output, run on a real Temporal executor. Whether an
 * external action runs is decided by the Executor's rule -- a node with
 * conditional predecessors runs when ANY of them allows it -- which a compiled
 * graph's shape does not show, so shape tests alone cannot settle routing.
 *
 * Activities stand in for handlers: a branch activates the successors whose
 * condition is the literal "true"; a verification gate passes and activates
 * its protected node; everything else returns its own key.
 */
function activities(called: string[]): ExecutorActivities {
  return {
    async executeNode(input) {
      called.push(input.nodeKey);
      const config = JSON.parse(input.configJson) as {
        conditions?: Record<string, string>;
        verification?: { protected_node_key: string };
      };
      const output =
        config.verification !== undefined
          ? { activeSuccessors: [config.verification.protected_node_key], verification_status: "passed" }
          : config.conditions !== undefined
            ? {
                activeSuccessors: Object.entries(config.conditions)
                  .filter(([, expression]) => expression === "true")
                  .map(([key]) => key),
              }
            : { from: input.nodeKey };
      return { outputJson: JSON.stringify(output), metadataJson: "{}" };
    },
    async finalizeRun() {},
    async recordApprovalDecision() {},
  };
}

function skeletonDag(routeTo: string, withDataInput: boolean): CompiledDag {
  return compileTaskSkeletonToDag(
    {
      version: "1",
      entry_point: "classify",
      nodes: [
        { key: "classify", type: "llm", config: {}, depends_on: [] },
        { key: "route", type: "branch", config: { conditions: { send: routeTo } }, depends_on: ["classify"] },
        ...(withDataInput ? [{ key: "draft", type: "llm" as const, config: {}, depends_on: ["classify"] }] : []),
        { key: "send", type: "tool", config: {}, depends_on: withDataInput ? ["route", "draft"] : ["route"] },
      ],
    },
    "v1",
  );
}

type ArchitectureNode = ArchitectureCompileInput["architecture"]["nodes"][number];

function architectureDag(routeTo: string): CompiledDag {
  const nodes: ArchitectureNode[] = [
    { source_node_key: "classify", role: "direct", execution_kind: "llm", source_node_type: "llm", depends_on: [], config: {} },
    { source_node_key: "route", role: "control", execution_kind: "control", source_node_type: "branch", depends_on: ["classify"], config: { conditions: { send: routeTo } } },
    { source_node_key: "send", role: "deterministic", execution_kind: "deterministic", source_node_type: "tool", depends_on: ["route"], config: {} },
  ];
  return compileArchitectureToDag({
    tenant_id: "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
    workspace_id: "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
    workflow_id: "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
    dag_schema_version: "v1",
    architecture: {
      status: "ready",
      version: "1",
      topology: "sequential",
      boundaries: [{ kind: "verification", before_node_key: "send", reason: "verification precedes every external action" }],
      nodes,
      execution_waves: [{ order: 0, node_keys: ["classify"], depends_on_wave_orders: [] }],
    },
    binding_decision: { status: "ready", bindings: [] },
  });
}

describe.sequential("verified branch routing on a real executor", () => {
  let environment: TestWorkflowEnvironment;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createLocal();
  }, 180_000);

  afterAll(async () => {
    await environment?.teardown();
  });

  it.each([
    ["skeleton: branch routes to the action", () => skeletonDag("true", false), true],
    ["skeleton: branch routes away", () => skeletonDag("false", false), false],
    ["skeleton: branch routes away while another input verifies", () => skeletonDag("false", true), false],
    ["skeleton: branch routes to the action that also has a data input", () => skeletonDag("true", true), true],
    ["architecture: branch routes to the action", () => architectureDag("true"), true],
    ["architecture: branch routes away", () => architectureDag("false"), false],
  ] as const)("%s", { timeout: 120_000 }, async (name, build, actionRuns) => {
    const taskQueue = `verified-branch-${name.replaceAll(/[^a-z]+/g, "-")}`;
    const called: string[] = [];
    const worker = await createExecutorWorker(
      { address: environment.address, namespace: environment.namespace ?? "default", taskQueue },
      environment.nativeConnection,
      activities(called),
    );
    const running = worker.run();
    try {
      const handle = await environment.client.workflow.start("executorWorkflow", {
        taskQueue,
        workflowId: `${taskQueue}-workflow`,
        args: [{ tenantId: "ten_test", runId: "run_test", compiledDagJson: JSON.stringify(build()) }],
      });
      await handle.result();
      expect(called.includes("send")).toBe(actionRuns);
    } finally {
      worker.shutdown();
      await running;
    }
  });
});
