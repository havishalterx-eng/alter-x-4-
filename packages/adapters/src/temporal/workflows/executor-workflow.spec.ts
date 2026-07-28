import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledDag } from "@alterx/contracts";

import { createExecutorWorker } from "../worker";
import type { ExecutorActivities } from "../activities/executor-activities";

const WORKFLOW_TYPE = "executorWorkflow";

interface RunningWorker {
  readonly worker: Worker;
  readonly runPromise: Promise<void>;
}

function startWorker(worker: Worker): RunningWorker {
  return { worker, runPromise: worker.run() };
}

async function stopWorker(running: RunningWorker): Promise<void> {
  running.worker.shutdown();
  await running.runPromise;
}

function sequentialDag(): CompiledDag {
  return {
    schema_version: "v1",
    entry_node_keys: ["node_a"],
    nodes: [
      { key: "node_a", type: "ToolCall", config: {}, metadata: { ui: {} } },
      { key: "node_b", type: "ToolCall", config: {}, metadata: { ui: {} } },
    ],
    edges: [{ key: "node_a-to-node_b", from: "node_a", to: "node_b", kind: "sequential" }],
    waves: [
      { key: "wave_0", order: 0, node_keys: ["node_a"], depends_on: [] },
      { key: "wave_1", order: 1, node_keys: ["node_b"], depends_on: ["wave_0"] },
    ],
  };
}

function parallelWaveDag(): CompiledDag {
  return {
    schema_version: "v1",
    entry_node_keys: ["node_manager"],
    nodes: [
      { key: "node_manager", type: "LLMTask", config: {}, metadata: { ui: {} } },
      { key: "node_worker_a", type: "LLMTask", config: {}, metadata: { ui: {} } },
      { key: "node_worker_b", type: "LLMTask", config: {}, metadata: { ui: {} } },
      { key: "node_join", type: "Merge", config: {}, metadata: { ui: {} } },
    ],
    edges: [
      { key: "node_manager-to-node_worker_a", from: "node_manager", to: "node_worker_a", kind: "sequential" },
      { key: "node_manager-to-node_worker_b", from: "node_manager", to: "node_worker_b", kind: "sequential" },
      { key: "node_worker_a-to-node_join", from: "node_worker_a", to: "node_join", kind: "merge" },
      { key: "node_worker_b-to-node_join", from: "node_worker_b", to: "node_join", kind: "merge" },
    ],
    waves: [
      { key: "wave_0", order: 0, node_keys: ["node_manager"], depends_on: [] },
      { key: "wave_1", order: 1, node_keys: ["node_worker_a", "node_worker_b"], depends_on: ["wave_0"] },
      { key: "wave_2", order: 2, node_keys: ["node_join"], depends_on: ["wave_1"] },
    ],
  };
}

function echoingActivities(
  callOrder: string[],
  predecessorsSeenByNode: Record<string, readonly string[]> = {},
): ExecutorActivities {
  return {
    async executeNode(input) {
      callOrder.push(input.nodeKey);
      predecessorsSeenByNode[input.nodeKey] = input.predecessorKeys;
      return {
        outputJson: JSON.stringify({ from: input.nodeKey }),
        metadataJson: "{}",
      };
    },
  };
}

/** Tracks how many executeNode calls are in flight at once, for proving real concurrency. */
function concurrencyTrackingActivities(): {
  activities: ExecutorActivities;
  maxConcurrent: () => number;
} {
  let inFlight = 0;
  let max = 0;
  return {
    activities: {
      async executeNode(input) {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 50));
        inFlight -= 1;
        return {
          outputJson: JSON.stringify({ from: input.nodeKey }),
          metadataJson: "{}",
        };
      },
    },
    maxConcurrent: () => max,
  };
}

describe.sequential("executorWorkflow", () => {
  let environment: TestWorkflowEnvironment;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await environment.teardown();
  });

  function config(taskQueue: string) {
    return {
      address: environment.address,
      namespace: environment.namespace ?? "default",
      taskQueue,
    };
  }

  it("walks a sequential chain in order, passing only direct predecessors", async () => {
    const taskQueue = "executor-sequential";
    const callOrder: string[] = [];
    const predecessorsSeen: Record<string, readonly string[]> = {};
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        echoingActivities(callOrder, predecessorsSeen),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId: "executor-sequential-workflow",
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(sequentialDag()),
          },
        ],
      });

      const result = await handle.result();

      expect(callOrder).toEqual(["node_a", "node_b"]);
      expect(result.outputs).toEqual({
        node_a: { from: "node_a" },
        node_b: { from: "node_b" },
      });
      expect(predecessorsSeen["node_b"]).toEqual(["node_a"]);
      expect(predecessorsSeen["node_a"]).toEqual([]);
    } finally {
      await stopWorker(running);
    }
  });

  it("runs same-wave nodes concurrently, and merges at the join", async () => {
    const taskQueue = "executor-parallel-wave";
    const { activities, maxConcurrent } = concurrencyTrackingActivities();
    const running = startWorker(
      await createExecutorWorker(config(taskQueue), environment.nativeConnection, activities),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId: "executor-parallel-wave-workflow",
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(parallelWaveDag()),
          },
        ],
      });

      const result = await handle.result();

      // Proves node_worker_a and node_worker_b actually overlapped in time
      // (Promise.all), not a sequential await-in-a-loop that happens to
      // visit both keys.
      expect(maxConcurrent()).toBe(2);
      expect(result.outputs["node_join"]).toEqual({ from: "node_join" });
      expect(Object.keys(result.outputs).sort()).toEqual([
        "node_join",
        "node_manager",
        "node_worker_a",
        "node_worker_b",
      ]);
    } finally {
      await stopWorker(running);
    }
  });

  it("fails the workflow on malformed compiledDagJson", async () => {
    const taskQueue = "executor-bad-json";
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        echoingActivities([]),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId: "executor-bad-json-workflow",
        args: [{ tenantId: "ten_test", runId: "run_test", compiledDagJson: "{not json" }],
      });

      await expect(handle.result()).rejects.toThrow();
    } finally {
      await stopWorker(running);
    }
  });

  it("fails the workflow on a DAG that fails CompiledDagSchema", async () => {
    const taskQueue = "executor-bad-schema";
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        echoingActivities([]),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId: "executor-bad-schema-workflow",
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify({ nodes: [] }),
          },
        ],
      });

      await expect(handle.result()).rejects.toThrow();
    } finally {
      await stopWorker(running);
    }
  });
});
