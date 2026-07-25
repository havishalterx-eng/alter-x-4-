import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { Worker } from "@temporalio/worker";

import { ConversationDispatchClient } from "../temporal/conversation-dispatch-client";
import { createConversationLifecycleWorker } from "../temporal/worker";

// Vendor-SDK isolation for cross-package integration tests: other packages
// and apps need a real local Temporal test server to verify real
// signal-with-start / workflow behavior, but must never import
// @temporalio/testing or @temporalio/worker directly (Engine apps are
// forbidden from importing vendor SDKs outside packages/adapters -- see
// scripts/check-architecture-boundaries.sh). This wraps the real test
// server + a real conversationLifecycleWorkflow worker + a real dispatch
// client behind one adapters-owned function.
export interface ConversationLifecycleTestHarness {
  readonly dispatchClient: ConversationDispatchClient;
  query<T>(workflowId: string, queryName: string): Promise<T>;
  signal(
    workflowId: string,
    signalName: string,
    payload: unknown,
  ): Promise<void>;
  teardown(): Promise<void>;
}

export async function createConversationLifecycleTestHarness(
  taskQueue: string,
): Promise<ConversationLifecycleTestHarness> {
  const environment = await TestWorkflowEnvironment.createLocal();
  const config = {
    address: environment.address,
    namespace: environment.namespace ?? "default",
    taskQueue,
  };
  const worker: Worker = await createConversationLifecycleWorker(
    config,
    environment.nativeConnection,
  );
  const runPromise = worker.run();
  const dispatchClient = new ConversationDispatchClient(
    config,
    environment.connection,
  );

  return {
    dispatchClient,
    query: (workflowId, queryName) =>
      environment.client.workflow.getHandle(workflowId).query(queryName),
    signal: (workflowId, signalName, payload) =>
      environment.client.workflow
        .getHandle(workflowId)
        .signal(signalName, payload),
    async teardown() {
      await dispatchClient.close();
      worker.shutdown();
      await runPromise;
      await environment.teardown();
    },
  };
}
