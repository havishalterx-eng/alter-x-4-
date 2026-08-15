import { existsSync } from "node:fs";
import { join } from "node:path";

import { Worker, type NativeConnection } from "@temporalio/worker";

import type { ExecutorActivities } from "./activities/executor-activities";
import type { PlatformJobActivities } from "./activities/platform-job-activities";
import type { TriggerDispatchActivities } from "./activities/trigger-dispatch-activities";
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
  const basePath = join(__dirname, "workflows", "executor-worker-workflows");
  const compiledPath = `${basePath}.js`;
  return existsSync(compiledPath) ? compiledPath : `${basePath}.ts`;
}

/**
 * The first worker in this codebase to register real Activities --
 * executor-workflow.ts calls out to executeNode, implemented by
 * activities (all real I/O: the Node Execution Service gRPC call). The
 * workflow file itself stays activity-implementation-free (type-only
 * import), keeping it deterministic/sandboxable.
 *
 * INGR-7: the same worker also serves triggerDispatchWorkflow (cron
 * trigger fires) -- Temporal 1.20.3 takes a single workflowsPath, so the
 * executor-worker-workflows barrel re-exports both workflows.
 */
export function createExecutorWorker(
  config: TemporalConnectionConfig,
  connection: NativeConnection,
  activities: ExecutorActivities & Partial<TriggerDispatchActivities>,
): Promise<Worker> {
  return Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: executorWorkflowsPath(),
    activities,
  });
}

function platformJobWorkflowsPath(): string {
  const basePath = join(__dirname, "workflows", "platform-job-workflow");
  const compiledPath = `${basePath}.js`;
  return existsSync(compiledPath) ? compiledPath : `${basePath}.ts`;
}

/**
 * Real worker for the `platform` Temporal namespace (doc 12, Engagement
 * Phase Platform Jobs). One generic workflow + activity-registry dispatch
 * (see platform-job-activities.ts) -- new real job types register a
 * handler, they don't need a new worker or workflow file.
 */
export function createPlatformJobsWorker(
  config: TemporalConnectionConfig,
  connection: NativeConnection,
  activities: PlatformJobActivities,
): Promise<Worker> {
  return Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: platformJobWorkflowsPath(),
    activities,
  });
}
