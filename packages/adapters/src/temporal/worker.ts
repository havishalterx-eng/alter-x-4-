import { existsSync } from "node:fs";
import { join } from "node:path";

import { Worker, type NativeConnection } from "@temporalio/worker";

import type { ExecutorActivities } from "./activities/executor-activities";
import type { TemporalConnectionConfig } from "./durable-execution-provider";

function foundationWorkflowsPath(): string {
  const basePath = join(
    __dirname,
    "workflows",
    "foundation-noop-workflow",
  );
  const compiledPath = `${basePath}.js`;
  return existsSync(compiledPath) ? compiledPath : `${basePath}.ts`;
}

export function createFoundationWorker(
  config: TemporalConnectionConfig,
  connection: NativeConnection,
): Promise<Worker> {
  return Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: foundationWorkflowsPath(),
  });
}

function conversationLifecycleWorkflowsPath(): string {
  const basePath = join(
    __dirname,
    "workflows",
    "conversation-lifecycle-workflow",
  );
  const compiledPath = `${basePath}.js`;
  return existsSync(compiledPath) ? compiledPath : `${basePath}.ts`;
}

export function createConversationLifecycleWorker(
  config: TemporalConnectionConfig,
  connection: NativeConnection,
): Promise<Worker> {
  return Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: conversationLifecycleWorkflowsPath(),
  });
}

function executorWorkflowsPath(): string {
  const basePath = join(__dirname, "workflows", "executor-workflow");
  const compiledPath = `${basePath}.js`;
  return existsSync(compiledPath) ? compiledPath : `${basePath}.ts`;
}

/**
 * The first worker in this codebase to register real Activities --
 * executor-workflow.ts calls out to executeNode, implemented by
 * activities (all real I/O: the Node Execution Service gRPC call). The
 * workflow file itself stays activity-implementation-free (type-only
 * import), keeping it deterministic/sandboxable.
 */
export function createExecutorWorker(
  config: TemporalConnectionConfig,
  connection: NativeConnection,
  activities: ExecutorActivities,
): Promise<Worker> {
  return Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: executorWorkflowsPath(),
    activities,
  });
}
