import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { Worker } from "@temporalio/worker";

import { createExecutorWorker } from "../temporal/worker";
import type { ExecutorActivities } from "../temporal/activities/executor-activities";
import type {
  ExecutorWorkflowInput,
  ExecutorWorkflowResult,
} from "../temporal/workflows/executor-workflow";

const WORKFLOW_TYPE = "executorWorkflow";

export interface ExecutorTestHarness {
  run(workflowId: string, input: ExecutorWorkflowInput): Promise<ExecutorWorkflowResult>;
  teardown(): Promise<void>;
}

/**
 * Real Temporal test-server wrapper for Engine-app integration tests.
 * Keeps @temporalio imports confined to packages/adapters.
 */
export async function createExecutorTestHarness(
  taskQueue: string,
  activities: ExecutorActivities,
): Promise<ExecutorTestHarness> {
  const environment = await TestWorkflowEnvironment.createLocal();
  const worker: Worker = await createExecutorWorker(
    {
      address: environment.address,
      namespace: environment.namespace ?? "default",
      taskQueue,
    },
    environment.nativeConnection,
    activities,
  );
  const runPromise = worker.run();

  return {
    async run(workflowId, input) {
      const handle = await environment.client.workflow.start(WORKFLOW_TYPE, {
        taskQueue,
        workflowId,
        args: [input],
      });
      return handle.result();
    },
    async teardown() {
      worker.shutdown();
      await runPromise;
      await environment.teardown();
    },
  };
}
