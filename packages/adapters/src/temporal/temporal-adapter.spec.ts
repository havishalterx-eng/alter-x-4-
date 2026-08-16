import {
  TerminatedFailure,
  WorkflowFailedError,
} from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TEMPORAL_HEALTH_TIMEOUT_MS,
  TemporalConfigurationError,
  TemporalDurableExecutionProvider,
  type TemporalConnectionConfig,
} from "./durable-execution-provider";
import { createFoundationWorker } from "./worker";

const WORKFLOW_TYPE = "foundationNoopWorkflow";

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

describe.sequential("TemporalDurableExecutionProvider", () => {
  let environment: TestWorkflowEnvironment;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await environment.teardown();
  });

  function config(taskQueue: string): TemporalConnectionConfig {
    return {
      address: environment.address,
      namespace: environment.namespace ?? "default",
      taskQueue,
    };
  }

  it("survives worker shutdown, replays persisted history, and resumes", async () => {
    const temporalConfig = config("foundation-recovery-proof");
    const provider = new TemporalDurableExecutionProvider(
      temporalConfig,
      environment.connection,
    );
    const workflowId = "foundation-recovery-proof-workflow";
    const workerOne = startWorker(
      await createFoundationWorker(
        temporalConfig,
        environment.nativeConnection,
      ),
    );

    await provider.startWorkflow({
      workflowId,
      workflowType: WORKFLOW_TYPE,
      input: { phase: "foundation" },
    });
    await expect(
      provider.queryWorkflow({ workflowId, queryName: "input" }),
    ).resolves.toMatchObject({ value: { phase: "foundation" } });
    await expect(
      provider.queryWorkflow({ workflowId, queryName: "status" }),
    ).resolves.toMatchObject({ value: "waiting" });

    await provider.signalWorkflow({
      workflowId,
      signalName: "advance",
      payload: { step: 1 },
    });
    await expect(
      provider.queryWorkflow({ workflowId, queryName: "signals" }),
    ).resolves.toMatchObject({ value: [{ step: 1 }] });
    await stopWorker(workerOne);

    const workerTwo = startWorker(
      await createFoundationWorker(
        temporalConfig,
        environment.nativeConnection,
      ),
    );
    try {
      await expect(
        provider.queryWorkflow({ workflowId, queryName: "status" }),
      ).resolves.toMatchObject({ value: "advanced" });
      await expect(
        provider.queryWorkflow({ workflowId, queryName: "signals" }),
      ).resolves.toMatchObject({ value: [{ step: 1 }] });

      await provider.signalWorkflow({
        workflowId,
        signalName: "advance",
        payload: { step: 2 },
      });
      await environment.client.workflow.getHandle(workflowId).result();
      await expect(
        provider.queryWorkflow({ workflowId, queryName: "status" }),
      ).resolves.toMatchObject({ value: "done" });
    } finally {
      await stopWorker(workerTwo);
    }
  });

  it("deletes a cron schedule idempotently when it does not exist", async () => {
    const provider = new TemporalDurableExecutionProvider(
      config("foundation-schedule"),
      environment.connection,
    );
    await expect(
      provider.deleteCronSchedule("alter-trigger-never-created"),
    ).resolves.toBeUndefined();
  });

  it("reports live namespace connectivity and fails fast when unreachable", async () => {
    const liveProvider = new TemporalDurableExecutionProvider(
      config("foundation-health"),
    );
    const liveHealth = await liveProvider.healthCheck();
    expect(liveHealth.status).toBe("healthy");
    expect(liveHealth.latencyMs).toBeGreaterThanOrEqual(0);
    await liveProvider.close();

    const unreachableProvider = new TemporalDurableExecutionProvider({
      address: "127.0.0.1:1",
      namespace: "default",
      taskQueue: "foundation-unreachable",
    });
    const startedAt = Date.now();
    const unreachableHealth = await unreachableProvider.healthCheck();
    expect(unreachableHealth.status).toBe("unhealthy");
    expect(Date.now() - startedAt).toBeLessThan(
      TEMPORAL_HEALTH_TIMEOUT_MS + 2_000,
    );
    expect(unreachableHealth.details).toMatchObject({
      namespaceReachable: false,
    });
    await unreachableProvider.close();
  });

  it("starts a workflow and propagates its termination reason", async () => {
    const temporalConfig = config("foundation-termination");
    const provider = new TemporalDurableExecutionProvider(
      temporalConfig,
      environment.connection,
    );
    const running = startWorker(
      await createFoundationWorker(
        temporalConfig,
        environment.nativeConnection,
      ),
    );
    const workflowId = "foundation-termination-workflow";
    const reason = "foundation termination proof";

    try {
      const started = await provider.startWorkflow({
        workflowId,
        workflowType: WORKFLOW_TYPE,
        input: null,
      });
      expect(started.workflowId).toBe(workflowId);
      expect(started.runId).not.toHaveLength(0);

      await provider.terminateWorkflow({ workflowId, reason });
      try {
        await environment.client.workflow.getHandle(workflowId).result();
        throw new Error("Expected the terminated workflow result to reject");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(WorkflowFailedError);
        expect((error as WorkflowFailedError).cause).toBeInstanceOf(
          TerminatedFailure,
        );
        expect((error as WorkflowFailedError).cause?.message).toBe(reason);
      }
    } finally {
      await stopWorker(running);
    }
  });

  it("enforces a requested workflow execution timeout", async () => {
    const temporalConfig = config("foundation-execution-timeout");
    const provider = new TemporalDurableExecutionProvider(
      temporalConfig,
      environment.connection,
    );
    const running = startWorker(
      await createFoundationWorker(
        temporalConfig,
        environment.nativeConnection,
      ),
    );
    const workflowId = "foundation-execution-timeout-workflow";

    try {
      await provider.startWorkflow({
        workflowId,
        workflowType: WORKFLOW_TYPE,
        input: null,
        executionTimeout: "1s",
      });
      await expect(
        environment.client.workflow.getHandle(workflowId).result(),
      ).rejects.toBeInstanceOf(WorkflowFailedError);
    } finally {
      await stopWorker(running);
    }
  });

  it("isolates two independently configured provider instances", async () => {
    const configOne = config("foundation-isolation-one");
    const configTwo = {
      ...config("foundation-isolation-two"),
      apiKey: "local-ephemeral-test-only",
    };
    const providerOne = new TemporalDurableExecutionProvider(
      configOne,
      environment.connection,
    );
    const providerTwo = new TemporalDurableExecutionProvider(
      configTwo,
      environment.connection,
    );
    const workerOne = startWorker(
      await createFoundationWorker(configOne, environment.nativeConnection),
    );
    const workerTwo = startWorker(
      await createFoundationWorker(configTwo, environment.nativeConnection),
    );

    try {
      await providerOne.startWorkflow({
        workflowId: "foundation-isolation-one-workflow",
        workflowType: WORKFLOW_TYPE,
        input: "one",
      });
      await providerTwo.startWorkflow({
        workflowId: "foundation-isolation-two-workflow",
        workflowType: WORKFLOW_TYPE,
        input: "two",
      });
      await providerOne.signalWorkflow({
        workflowId: "foundation-isolation-one-workflow",
        signalName: "advance",
        payload: 1,
      });

      await expect(
        providerOne.queryWorkflow({
          workflowId: "foundation-isolation-one-workflow",
          queryName: "status",
        }),
      ).resolves.toMatchObject({ value: "advanced" });
      await expect(
        providerTwo.queryWorkflow({
          workflowId: "foundation-isolation-two-workflow",
          queryName: "status",
        }),
      ).resolves.toMatchObject({ value: "waiting" });
    } finally {
      await providerOne.close();
      await Promise.all([stopWorker(workerOne), stopWorker(workerTwo)]);
    }
  });

  it("rejects incomplete connection configuration", () => {
    expect(
      () =>
        new TemporalDurableExecutionProvider({
          address: " ",
          namespace: "default",
          taskQueue: "queue",
        }),
    ).toThrow(TemporalConfigurationError);
    expect(
      () =>
        new TemporalDurableExecutionProvider({
          address: "localhost:7233",
          namespace: "",
          taskQueue: "queue",
        }),
    ).toThrow(TemporalConfigurationError);
    expect(
      () =>
        new TemporalDurableExecutionProvider({
          address: "localhost:7233",
          namespace: "default",
          taskQueue: "",
        }),
    ).toThrow(TemporalConfigurationError);
    expect(
      () =>
        new TemporalDurableExecutionProvider({
          address: "localhost:7233",
          namespace: "default",
          taskQueue: "queue",
          apiKey: " ",
        }),
    ).toThrow(TemporalConfigurationError);
  });
});
