import { NativeConnection } from "@temporalio/worker";

import { createExecutorActivities } from "./activities/executor-activities";
import type { TemporalConnectionConfig } from "./durable-execution-provider";
import { createExecutorWorker } from "./worker";
import { BlackboardClient, type BlackboardClientConfig } from "../grpc/blackboard-client";
import { NodeExecutionClient, type NodeExecutionClientConfig } from "../grpc/nodeexec-client";

export interface ExecutorWorkerBootstrapConfig {
  readonly temporal: TemporalConnectionConfig;
  readonly nodeexec: NodeExecutionClientConfig;
  readonly blackboard: BlackboardClientConfig;
}

export interface ExecutorWorkerHandle {
  shutdown(): void;
}

/**
 * Full Executor worker bootstrap: connects to Temporal, builds the
 * NodeExecutionClient + Activities, starts the worker, and returns an
 * opaque handle. This is the ONLY function apps/background-workers calls
 * -- it never touches @temporalio/worker directly (adapter law: vendor
 * SDKs live only in packages/adapters).
 */
export async function startExecutorWorker(
  config: ExecutorWorkerBootstrapConfig,
): Promise<ExecutorWorkerHandle> {
  const connection = await NativeConnection.connect({
    address: config.temporal.address,
    ...(config.temporal.apiKey === undefined
      ? {}
      : { apiKey: config.temporal.apiKey, tls: true }),
  });

  const nodeExecutionClient = new NodeExecutionClient(config.nodeexec);
  const blackboardClient = new BlackboardClient(config.blackboard);
  const activities = createExecutorActivities(nodeExecutionClient, blackboardClient);
  const worker = await createExecutorWorker(config.temporal, connection, activities);

  void worker.run();

  return {
    shutdown: () => worker.shutdown(),
  };
}
