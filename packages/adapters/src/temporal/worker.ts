import { existsSync } from "node:fs";
import { join } from "node:path";

import { Worker, type NativeConnection } from "@temporalio/worker";

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
