import { WorkflowFailedError } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledDag } from "@alterx/contracts";

import { createExecutorWorker } from "../worker";
import type { ExecutorActivities } from "../activities/executor-activities";
import { approvalDecidedSignal, nodeRetryDecidedSignal } from "./executor-workflow";

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

function singleNodeDag(): CompiledDag {
  return {
    schema_version: "v1",
    entry_node_keys: ["node_a"],
    nodes: [{ key: "node_a", type: "ToolCall", config: {}, metadata: { ui: {} } }],
    edges: [],
    waves: [{ key: "wave_0", order: 0, node_keys: ["node_a"], depends_on: [] }],
  };
}

/**
 * Fails every call up to (and including) `failuresBeforeSuccess`, then
 * succeeds. proxyActivities' own maximumAttempts: 3 retries a thrown
 * activity BEFORE executor-workflow.ts's own catch ever sees it -- set
 * `failuresBeforeSuccess >= 3` for a test to reach the real recovery
 * pause; the same or a higher number to exhaust it entirely for a
 * give_up/timeout test.
 */
function failNTimesThenSucceedActivities(
  failuresBeforeSuccess: number,
  nodeExecutionIdsCaptured: string[],
): ExecutorActivities {
  let callCount = 0;
  return {
    async executeNode(input) {
      callCount += 1;
      nodeExecutionIdsCaptured.push(input.nodeExecutionId);
      if (callCount <= failuresBeforeSuccess) {
        throw new Error(`simulated failure ${callCount}`);
      }
      return {
        outputJson: JSON.stringify({ from: input.nodeKey, attempt: callCount }),
        metadataJson: "{}",
      };
    },
    async finalizeRun() {},
    async recordApprovalDecision() {},
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

/**
 * A Gate protecting one external-action node via a conditional edge --
 * the real shape Planning's Graph Compiler already produces
 * (injectVerificationGates), used here to prove the Self-Healing
 * exit-check finding: the Executor previously never read `kind:
 * "conditional"` edges at all, so a Gate's decision had zero effect on
 * whether the guarded node actually ran.
 */
function gatedDag(): CompiledDag {
  return {
    schema_version: "v1",
    entry_node_keys: ["node_gate"],
    nodes: [
      { key: "node_gate", type: "Gate", config: {}, metadata: { ui: {} } },
      { key: "node_protected", type: "ToolCall", config: {}, metadata: { ui: {} } },
    ],
    edges: [
      {
        key: "node_gate-to-node_protected",
        from: "node_gate",
        to: "node_protected",
        kind: "conditional",
        condition: { expression: "true", language: "cel" },
      },
    ],
    waves: [
      { key: "wave_0", order: 0, node_keys: ["node_gate"], depends_on: [] },
      { key: "wave_1", order: 1, node_keys: ["node_protected"], depends_on: ["wave_0"] },
    ],
  };
}

/**
 * Fakes the Gate node type's real output shape (GateHandler already
 * computes `activeSuccessors` correctly -- see gate.handler.ts; this test
 * targets only the Executor's enforcement of it, not Gate's own scoring
 * logic, which verification-gate.integration.spec.ts already covers).
 */
function gateActivities(
  gateOutput: Record<string, unknown>,
  callOrder: string[],
): ExecutorActivities {
  return {
    async executeNode(input) {
      callOrder.push(input.nodeKey);
      if (input.nodeType === "Gate") {
        return { outputJson: JSON.stringify(gateOutput), metadataJson: "{}" };
      }
      return {
        outputJson: JSON.stringify({ from: input.nodeKey }),
        metadataJson: "{}",
      };
    },
    async finalizeRun() {},
    async recordApprovalDecision() {},
  };
}

function humanApprovalDag(): CompiledDag {
  return {
    schema_version: "v1",
    entry_node_keys: ["node_a"],
    nodes: [
      { key: "node_a", type: "HumanApproval", config: {}, metadata: { ui: {} } },
      { key: "node_b", type: "ToolCall", config: {}, metadata: { ui: {} } },
    ],
    edges: [{ key: "node_a-to-node_b", from: "node_a", to: "node_b", kind: "sequential" }],
    waves: [
      { key: "wave_0", order: 0, node_keys: ["node_a"], depends_on: [] },
      { key: "wave_1", order: 1, node_keys: ["node_b"], depends_on: ["wave_0"] },
    ],
  };
}

/**
 * Simulates NodeexecService's real dispatch behavior for a HumanApproval
 * node (HEAL-7): returns a pending marker instead of a real output, and
 * captures the workflow-generated node_execution_id (via nodeExecutionIdCaptured)
 * so the test can target a signal at exactly this node, since that ID is
 * generated deterministically INSIDE the workflow (uuid4()) and is not
 * otherwise knowable to the test ahead of time.
 */
function pendingApprovalActivities(expiresInMs: number): {
  activities: ExecutorActivities;
  nodeExecutionIdCaptured: Promise<string>;
  recordCalls: unknown[];
} {
  let resolveCaptured!: (id: string) => void;
  const nodeExecutionIdCaptured = new Promise<string>((resolve) => {
    resolveCaptured = resolve;
  });
  const recordCalls: unknown[] = [];
  return {
    activities: {
      async executeNode(input) {
        if (input.nodeType === "HumanApproval") {
          resolveCaptured(input.nodeExecutionId);
          return {
            outputJson: JSON.stringify({
              approval_id: "apr_test",
              status: "pending",
              expiry_at: new Date(Date.now() + expiresInMs).toISOString(),
            }),
            metadataJson: JSON.stringify({ execution_status: "pending_approval" }),
            pending: true,
            expiresInMs,
          };
        }
        return {
          outputJson: JSON.stringify({ from: input.nodeKey }),
          metadataJson: "{}",
        };
      },
      async finalizeRun() {},
      async recordApprovalDecision(input) {
        recordCalls.push(input);
      },
    },
    nodeExecutionIdCaptured,
    recordCalls,
  };
}

function echoingActivities(
  callOrder: string[],
  predecessorsSeenByNode: Record<string, readonly string[]> = {},
  finalizeCalls: unknown[] = [],
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
    async finalizeRun(input) {
      finalizeCalls.push(input);
    },
    async recordApprovalDecision() {},
  };
}

/**
 * Delays one node's activity long enough for the test to shut down the
 * worker while that activity is genuinely in flight -- a real worker-kill
 * mid-run scenario, not just a restart between already-completed steps.
 *
 * `onStart` fires synchronously the instant the delayed node's activity is
 * invoked, before the delay -- the test awaits it instead of guessing a
 * wall-clock margin, so "the activity has genuinely started" is
 * deterministic regardless of how fast/slow the host machine schedules
 * the workflow start -> activity dispatch round trip (this raced and
 * flaked on a slower CI runner with a fixed sleep-based guess).
 */
function delayedEchoingActivities(
  delayedNodeKey: string,
  delayMs: number,
  callOrder: string[],
  finalizeCalls: unknown[] = [],
  onStart?: (nodeKey: string) => void,
): ExecutorActivities {
  return {
    async executeNode(input) {
      if (input.nodeKey === delayedNodeKey) {
        onStart?.(input.nodeKey);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      callOrder.push(input.nodeKey);
      return {
        outputJson: JSON.stringify({ from: input.nodeKey }),
        metadataJson: "{}",
      };
    },
    async finalizeRun(input) {
      finalizeCalls.push(input);
    },
    async recordApprovalDecision() {},
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
      async finalizeRun() {},
      async recordApprovalDecision() {},
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

  it("walks a sequential chain in order, passing only direct predecessors, and finalizes the run as completed", async () => {
    const taskQueue = "executor-sequential";
    const callOrder: string[] = [];
    const predecessorsSeen: Record<string, readonly string[]> = {};
    const finalizeCalls: unknown[] = [];
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        echoingActivities(callOrder, predecessorsSeen, finalizeCalls),
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
      expect(finalizeCalls).toEqual([
        expect.objectContaining({
          tenantId: "ten_test",
          runId: "run_test",
          status: "completed",
          errorJson: "",
        }),
      ]);
    } finally {
      await stopWorker(running);
    }
  });

  it("survives a worker kill mid-run: wave 0's activity is genuinely in flight when the worker is shut down, a fresh worker resumes and completes the run exactly once per node", async () => {
    const taskQueue = "executor-worker-kill-durability";
    const callOrder: string[] = [];
    const finalizeCalls: unknown[] = [];
    const workflowId = "executor-worker-kill-durability-workflow";

    let notifyStarted: (() => void) | undefined;
    const nodeAStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });

    const workerOne = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        // node_a's activity sleeps 500ms -- long enough to shut the worker
        // down while it is genuinely mid-execution, not just between
        // already-completed workflow steps. onStart fires before the
        // sleep, so the test can await "genuinely in flight" deterministically
        // instead of guessing a wall-clock margin (a fixed sleep here raced
        // and flaked on a slower CI runner).
        delayedEchoingActivities("node_a", 500, callOrder, finalizeCalls, () =>
          notifyStarted?.(),
        ),
      ),
    );

    const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
      taskQueue,
      workflowId,
      args: [
        {
          tenantId: "ten_test",
          runId: "run_test",
          compiledDagJson: JSON.stringify(sequentialDag()),
        },
      ],
    });

    // Deterministic: node_a's activity has genuinely started (and is now
    // asleep for the remaining ~500ms) before we kill the worker underneath it.
    await nodeAStarted;
    await stopWorker(workerOne);

    // shutdown() stops polling for NEW tasks immediately but gracefully
    // drains the activity already in flight -- so node_a's delayed
    // activity finishes during the drain (same as a real SIGTERM), but
    // node_b's activity task cannot have been dispatched to workerOne:
    // it doesn't even exist on the server until node_a's completion is
    // reported, by which point workerOne already stopped accepting work.
    expect(callOrder).toEqual(["node_a"]);

    const workerTwo = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        delayedEchoingActivities("node_a", 0, callOrder, finalizeCalls),
      ),
    );

    try {
      const result = await handle.result();

      expect(result.outputs).toEqual({
        node_a: { from: "node_a" },
        node_b: { from: "node_b" },
      });
      // Each node's activity produced exactly one recorded execution --
      // proves the resumed run walked the DAG correctly, not a replay
      // artifact or a duplicated/skipped node.
      expect(callOrder).toEqual(["node_a", "node_b"]);
      expect(finalizeCalls).toEqual([
        expect.objectContaining({
          tenantId: "ten_test",
          runId: "run_test",
          status: "completed",
          errorJson: "",
        }),
      ]);
    } finally {
      await stopWorker(workerTwo);
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

  it("fails the workflow on malformed compiledDagJson and finalizes the run as failed", async () => {
    const taskQueue = "executor-bad-json";
    const finalizeCalls: unknown[] = [];
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        echoingActivities([], {}, finalizeCalls),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId: "executor-bad-json-workflow",
        args: [{ tenantId: "ten_test", runId: "run_test", compiledDagJson: "{not json" }],
      });

      await expect(handle.result()).rejects.toThrow();
      expect(finalizeCalls).toEqual([
        expect.objectContaining({ tenantId: "ten_test", runId: "run_test", status: "failed" }),
      ]);
      expect(JSON.parse((finalizeCalls[0] as { errorJson: string }).errorJson)).toMatchObject({
        name: "ExecutorWorkflowValidationError",
      });
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

  it("durably pauses a HumanApproval node, survives a worker restart, and resumes to completion on signal (HEAL-7)", async () => {
    const taskQueue = "executor-human-approval-durability";
    const workflowId = "executor-human-approval-durability-workflow";
    const { activities, nodeExecutionIdCaptured, recordCalls } = pendingApprovalActivities(
      5 * 60_000,
    );

    const workerOne = startWorker(
      await createExecutorWorker(config(taskQueue), environment.nativeConnection, activities),
    );

    const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
      taskQueue,
      workflowId,
      args: [
        {
          tenantId: "ten_test",
          runId: "run_test",
          compiledDagJson: JSON.stringify(humanApprovalDag()),
        },
      ],
    });

    const nodeExecutionId = await nodeExecutionIdCaptured;

    // Give the workflow a moment to actually enter its condition() wait
    // before killing the worker underneath it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await stopWorker(workerOne);

    // No worker is polling this task queue right now: the workflow is
    // durably parked in its condition() wait, persisted in Temporal
    // history -- not held in any process's memory. A fresh worker (never
    // having seen this workflow run before) picks up exactly where it
    // left off once signaled.
    const workerTwo = startWorker(
      await createExecutorWorker(config(taskQueue), environment.nativeConnection, activities),
    );

    try {
      await environment.client.workflow
        .getHandle(workflowId)
        .signal(approvalDecidedSignal, {
          nodeExecutionId,
          approved: true,
          note: "approved for test",
        });

      const result = await handle.result();

      expect(result.outputs["node_a"]).toEqual({ approved: true, note: "approved for test" });
      expect(result.outputs["node_b"]).toEqual({ from: "node_b" });
      expect(recordCalls).toEqual([
        expect.objectContaining({
          nodeExecutionId,
          nodeKey: "node_a",
          decision: "approved",
        }),
      ]);
    } finally {
      await stopWorker(workerTwo);
    }
  });

  it("fails the workflow when a HumanApproval node is rejected", async () => {
    const taskQueue = "executor-human-approval-rejected";
    const workflowId = "executor-human-approval-rejected-workflow";
    const { activities, nodeExecutionIdCaptured, recordCalls } = pendingApprovalActivities(
      5 * 60_000,
    );

    const running = startWorker(
      await createExecutorWorker(config(taskQueue), environment.nativeConnection, activities),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId,
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(humanApprovalDag()),
          },
        ],
      });

      const nodeExecutionId = await nodeExecutionIdCaptured;
      await environment.client.workflow
        .getHandle(workflowId)
        .signal(approvalDecidedSignal, { nodeExecutionId, approved: false, note: "denied" });

      const error = await handle.result().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WorkflowFailedError);
      expect((error as WorkflowFailedError).cause?.message).toMatch(/was rejected/);
      expect(recordCalls).toEqual([
        expect.objectContaining({ nodeExecutionId, decision: "rejected" }),
      ]);
    } finally {
      await stopWorker(running);
    }
  });

  it("fails the workflow when a HumanApproval node's expiry passes with no decision", async () => {
    const taskQueue = "executor-human-approval-expired";
    const workflowId = "executor-human-approval-expired-workflow";
    // A short expiry -- the test never sends a decision signal, proving
    // the condition() timeout path resolves the node as expired/rejected
    // on its own, without an external decision ever arriving.
    const { activities, recordCalls } = pendingApprovalActivities(200);

    const running = startWorker(
      await createExecutorWorker(config(taskQueue), environment.nativeConnection, activities),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId,
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(humanApprovalDag()),
          },
        ],
      });

      const error = await handle.result().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WorkflowFailedError);
      expect((error as WorkflowFailedError).cause?.message).toMatch(/expired/);
      expect(recordCalls).toEqual([
        expect.objectContaining({ decision: "rejected" }),
      ]);
    } finally {
      await stopWorker(running);
    }
  });

  it("real enforcement: a Gate that does not activate its successor prevents that node's activity from ever being invoked (Self-Healing exit-check finding)", async () => {
    const taskQueue = "executor-gate-blocks-protected-node";
    const callOrder: string[] = [];
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        gateActivities(
          { activeSuccessors: [], verification_status: "blocked_pending_recovery" },
          callOrder,
        ),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId: "executor-gate-blocks-protected-node-workflow",
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(gatedDag()),
          },
        ],
      });

      const result = await handle.result();

      expect(callOrder).toEqual(["node_gate"]);
      expect(callOrder).not.toContain("node_protected");
      expect(result.outputs["node_protected"]).toEqual({
        skipped: true,
        reason: "gated_off_by_verification",
        gate_node_keys: ["node_gate"],
      });
    } finally {
      await stopWorker(running);
    }
  });

  it("real enforcement: a Gate that activates its successor lets that node's activity run normally", async () => {
    const taskQueue = "executor-gate-allows-protected-node";
    const callOrder: string[] = [];
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        gateActivities(
          { activeSuccessors: ["node_protected"], verification_status: "passed" },
          callOrder,
        ),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId: "executor-gate-allows-protected-node-workflow",
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(gatedDag()),
          },
        ],
      });

      const result = await handle.result();

      expect(callOrder).toEqual(["node_gate", "node_protected"]);
      expect(result.outputs["node_protected"]).toEqual({ from: "node_protected" });
    } finally {
      await stopWorker(running);
    }
  });

  it("retry/backoff: a failed node pauses, resumes on a retry decision, and the second attempt completes the run (Self-Healing exit-check closure)", async () => {
    const taskQueue = "executor-node-retry-succeeds";
    const workflowId = "executor-node-retry-succeeds-workflow";
    const nodeExecutionIdsCaptured: string[] = [];
    // 3 failures exhausts proxyActivities' own maximumAttempts: 3 before
    // executor-workflow.ts's catch ever runs; the 4th call (post-signal)
    // succeeds.
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        failNTimesThenSucceedActivities(3, nodeExecutionIdsCaptured),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId,
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(singleNodeDag()),
            nodeRecoveryTimeoutMs: 5_000,
          },
        ],
      });

      // Poll until the first (exhausted) attempt has actually happened and
      // the workflow is durably parked in its recovery condition() wait --
      // real nodeExecutionId is only known once the activity has run.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const nodeExecutionId = nodeExecutionIdsCaptured[0];
      expect(nodeExecutionId).toBeDefined();

      await environment.client.workflow.getHandle(workflowId).signal(nodeRetryDecidedSignal, {
        nodeExecutionId: nodeExecutionId!,
        action: "retry",
      });

      const result = await handle.result();
      expect(result.outputs["node_a"]).toEqual({ from: "node_a", attempt: 4 });
    } finally {
      await stopWorker(running);
    }
  });

  it("retry/backoff: a give_up decision fails the workflow instead of retrying forever", async () => {
    const taskQueue = "executor-node-retry-gives-up";
    const workflowId = "executor-node-retry-gives-up-workflow";
    const nodeExecutionIdsCaptured: string[] = [];
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        // Always fails -- there is no "eventually succeeds" attempt here.
        failNTimesThenSucceedActivities(Number.POSITIVE_INFINITY, nodeExecutionIdsCaptured),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId,
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(singleNodeDag()),
            nodeRecoveryTimeoutMs: 5_000,
          },
        ],
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      const nodeExecutionId = nodeExecutionIdsCaptured[0];
      expect(nodeExecutionId).toBeDefined();

      await environment.client.workflow.getHandle(workflowId).signal(nodeRetryDecidedSignal, {
        nodeExecutionId: nodeExecutionId!,
        action: "give_up",
      });

      const error = await handle.result().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WorkflowFailedError);
      expect((error as WorkflowFailedError).cause?.message).toMatch(/recovery gave up/);
    } finally {
      await stopWorker(running);
    }
  });

  it("retry/backoff: times out and fails the workflow if no recovery decision ever arrives", async () => {
    const taskQueue = "executor-node-retry-times-out";
    const workflowId = "executor-node-retry-times-out-workflow";
    const nodeExecutionIdsCaptured: string[] = [];
    const running = startWorker(
      await createExecutorWorker(
        config(taskQueue),
        environment.nativeConnection,
        failNTimesThenSucceedActivities(Number.POSITIVE_INFINITY, nodeExecutionIdsCaptured),
      ),
    );

    try {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId,
        args: [
          {
            tenantId: "ten_test",
            runId: "run_test",
            compiledDagJson: JSON.stringify(singleNodeDag()),
            nodeRecoveryTimeoutMs: 200,
          },
        ],
      });

      const error = await handle.result().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WorkflowFailedError);
      expect((error as WorkflowFailedError).cause?.message).toMatch(/timed out awaiting a recovery decision/);
    } finally {
      await stopWorker(running);
    }
  });
});
