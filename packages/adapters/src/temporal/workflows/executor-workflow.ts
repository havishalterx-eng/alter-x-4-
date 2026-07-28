import { ApplicationFailure, proxyActivities, uuid4 } from "@temporalio/workflow";

import { CompiledDagSchema, type CompiledDag } from "@alterx/contracts";

import type { ExecutorActivities } from "../activities/executor-activities";

export interface ExecutorWorkflowInput {
  readonly tenantId: string; // ten_ prefixed UUIDv7
  readonly runId: string; // run_ prefixed UUIDv7
  readonly compiledDagJson: string;
}

export interface ExecutorWorkflowResult {
  /** Every node's output, keyed by node key. */
  readonly outputs: Record<string, Record<string, unknown>>;
}

const EXECUTOR_WORKFLOW_VALIDATION_ERROR_TYPE = "ExecutorWorkflowValidationError";

/**
 * A plain `throw new Error(...)` inside workflow code is treated by
 * Temporal as a *workflow task* failure, not a workflow failure -- the
 * SDK retries the task indefinitely with backoff, which for a permanent
 * validation problem (bad DAG JSON) means silently burning worker compute
 * forever instead of ever surfacing to the caller. ApplicationFailure.
 * nonRetryable is the only way to make a workflow-code throw actually
 * fail the workflow (visible via handle.result() rejecting).
 */
function validationFailure(message: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(
    message,
    EXECUTOR_WORKFLOW_VALIDATION_ERROR_TYPE,
  );
}

const { executeNode } = proxyActivities<ExecutorActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    // A handler validation/unimplemented-type failure will never succeed on
    // retry -- this is deliberately small (no Recovery Policy Engine exists
    // yet, that's Self-Healing phase). A transient gRPC hiccup gets 3 tries;
    // anything else fails the workflow, which is the correct "core" behavior
    // until real recovery strategies land.
    maximumAttempts: 3,
  },
});

function nodeExecutionId(): string {
  // Same version-nibble-patch technique already used elsewhere in this
  // codebase (e.g. trigger-registry.controller.ts's prefixedUuidV7) --
  // uuid4() here is Temporal's deterministic-replay-safe generator, not
  // Node's crypto.randomUUID(), which workflow code may never call directly.
  const id = uuid4();
  return `node_${id.slice(0, 14)}7${id.slice(15)}`;
}

function directPredecessorKeys(dag: CompiledDag, nodeKey: string): string[] {
  return dag.edges.filter((edge) => edge.to === nodeKey).map((edge) => edge.from);
}

function orderedWaves(dag: CompiledDag): CompiledDag["waves"] {
  return [...dag.waves].sort((a, b) => a.order - b.order);
}

export async function executorWorkflow(
  input: ExecutorWorkflowInput,
): Promise<ExecutorWorkflowResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(input.compiledDagJson);
  } catch (error: unknown) {
    throw validationFailure(
      `compiledDagJson is not valid JSON: ${(error as Error).message}`,
    );
  }
  const parsed = CompiledDagSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationFailure(
      `compiledDagJson does not match CompiledDag: ${parsed.error.message}`,
    );
  }
  const dag = parsed.data;
  const nodesByKey = new Map(dag.nodes.map((node) => [node.key, node]));

  const outputs: Record<string, Record<string, unknown>> = {};

  // Parallel-wave execution (EXEC-7): waves run in order (wave N depends
  // on wave N-1), but every node within a wave is independent of its
  // wave-mates by construction (Graph Compiler's Kahn's-algorithm wave
  // assignment guarantees this) -- so they execute concurrently via
  // Promise.all. Cross-node data flows through the Blackboard (each
  // activity reads its own predecessors and writes its own output there,
  // see executor-activities.ts), not through this workflow's local
  // memory, so concurrent execution within a wave never races on shared
  // in-process state.
  for (const wave of orderedWaves(dag)) {
    const waveResults = await Promise.all(
      wave.node_keys.map(async (nodeKey) => {
        const node = nodesByKey.get(nodeKey);
        if (node === undefined) {
          throw validationFailure(`Wave references unknown node key "${nodeKey}"`);
        }

        const result = await executeNode({
          tenantId: input.tenantId,
          runId: input.runId,
          nodeExecutionId: nodeExecutionId(),
          nodeKey: node.key,
          nodeType: node.type,
          configJson: JSON.stringify(node.config),
          predecessorKeys: directPredecessorKeys(dag, nodeKey),
        });

        return [nodeKey, JSON.parse(result.outputJson) as Record<string, unknown>] as const;
      }),
    );

    for (const [nodeKey, output] of waveResults) {
      outputs[nodeKey] = output;
    }
  }

  return { outputs };
}
