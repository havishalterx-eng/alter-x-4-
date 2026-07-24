import { describe, expect, it } from "vitest";
import { createMockConfigProvider } from "./mocks/config-provider";
import {
  DurableWorkflowAlreadyExistsError,
  DurableWorkflowNotFoundError,
  createMockDurableExecutionProvider,
} from "./mocks/durable-execution-provider";
import { createMockModelProvider } from "./mocks/model-provider";
import { createMockObservabilityProvider } from "./mocks/observability-provider";
import {
  InvalidSecretReferenceError,
  SecretNotFoundError,
  createMockSecretsProvider,
} from "./mocks/secrets-provider";

describe("SecretsProvider mock", () => {
  it("resolves configured references deterministically without exposing values in metadata", async () => {
    const provider = createMockSecretsProvider({
      secrets: { "tenant/integration/token": "private-value" },
    });

    await expect(
      provider.getSecret("tenant/integration/token"),
    ).resolves.toBe("private-value");
    expect(JSON.stringify(provider.metadata)).not.toContain("private-value");
  });

  it("rejects malformed and unknown references with typed errors", async () => {
    const provider = createMockSecretsProvider();
    await expect(provider.getSecret("bad reference")).rejects.toBeInstanceOf(
      InvalidSecretReferenceError,
    );
    await expect(provider.getSecret("unknown/ref")).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
  });
});

describe("ObservabilityProvider mock", () => {
  it("captures all four normalized telemetry pillars in memory", async () => {
    const provider = createMockObservabilityProvider();

    await provider.emitTrace({
      traceId: "trace-1",
      spanId: "span-1",
      name: "workflow.run",
      startedAt: "2026-07-22T00:00:00.000Z",
    });
    await provider.emitMetric({
      name: "workflow.completed",
      value: 1,
      recordedAt: "2026-07-22T00:00:01.000Z",
    });
    await provider.emitLog({
      severity: "info",
      message: "workflow complete",
      recordedAt: "2026-07-22T00:00:01.000Z",
    });
    await provider.captureError({
      name: "WorkflowError",
      message: "verification failed",
      occurredAt: "2026-07-22T00:00:02.000Z",
      traceId: "trace-1",
    });

    expect(provider.getEmissions()).toMatchObject({
      traces: [{ name: "workflow.run" }],
      metrics: [{ name: "workflow.completed", value: 1 }],
      logs: [{ severity: "info", message: "workflow complete" }],
      errors: [{ name: "WorkflowError", traceId: "trace-1" }],
    });
  });
});

describe("ConfigProvider mock", () => {
  it("resolves each alias tier to a distinct model binding", async () => {
    const provider = createMockConfigProvider();

    await expect(provider.resolveModelAlias("FAST")).resolves.toMatchObject({
      model_id: "mock.fast.v1",
    });
    await expect(
      provider.resolveModelAlias("CEILING"),
    ).resolves.toMatchObject({ model_id: "mock.ceiling.v1" });
    await expect(
      provider.resolveToolPermission({
        tenantId: "tenant-1",
        toolName: "contract.search",
      }),
    ).resolves.toEqual({
      allowed: true,
      rateLimitPerMinute: 60,
      requiredScopes: [],
    });
  });

  it("rejects an alias absent from the policy instead of silently downgrading", async () => {
    const provider = createMockConfigProvider({
      policy: {
        version: "partial.1",
        bindings: {
          FAST: { model_id: "mock.fast.v1", capability_tags: [] },
          STANDARD: { model_id: "mock.standard.v1", capability_tags: [] },
          ADVANCED: { model_id: "mock.advanced.v1", capability_tags: [] },
          CEILING: { model_id: "mock.ceiling.v1", capability_tags: [] },
        },
      },
    });

    await expect(
      provider.resolveModelAlias(
        "UNKNOWN" as Parameters<typeof provider.resolveModelAlias>[0],
      ),
    ).rejects.toMatchObject({
      name: "ModelAliasResolutionError",
      message: expect.stringContaining("UNKNOWN"),
    });
  });
});

describe("ModelProvider mock", () => {
  it("invokes and returns parseable output and usage JSON", async () => {
    const provider = createMockModelProvider();

    const result = await provider.invoke({
      tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
      nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
      modelId: "mock.standard.v1",
      capabilityTags: ["general"],
      inputJson: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(JSON.parse(result.outputJson)).toEqual({
      message: {
        role: "assistant",
        content: "mock response to: hello",
      },
      stop_reason: "end_turn",
    });
    expect(JSON.parse(result.usageJson)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
    });
  });
});

describe("DurableExecutionProvider mock", () => {
  it("starts, signals, queries, and terminates deterministic workflows", async () => {
    const provider = createMockDurableExecutionProvider();
    const handle = await provider.startWorkflow({
      workflowId: "workflow-1",
      workflowType: "test",
      input: { prompt: "hello" },
    });

    expect(handle).toEqual({
      workflowId: "workflow-1",
      runId: "workflow-1:mock-run",
    });
    await provider.signalWorkflow({
      workflowId: "workflow-1",
      signalName: "approve",
      payload: { approved: true },
    });
    await expect(
      provider.queryWorkflow({
        workflowId: "workflow-1",
        queryName: "input",
      }),
    ).resolves.toMatchObject({ value: { prompt: "hello" } });
    await expect(
      provider.queryWorkflow({
        workflowId: "workflow-1",
        queryName: "signals",
      }),
    ).resolves.toMatchObject({
      value: [{ signalName: "approve", payload: { approved: true } }],
    });

    await provider.terminateWorkflow({
      workflowId: "workflow-1",
      reason: "test complete",
    });
    await expect(
      provider.queryWorkflow({
        workflowId: "workflow-1",
        queryName: "status",
      }),
    ).resolves.toMatchObject({
      value: {
        status: "terminated",
        terminationReason: "test complete",
      },
    });
    expect(provider.listWorkflowIds()).toEqual(["workflow-1"]);
  });

  it("rejects duplicate, missing, and post-termination operations", async () => {
    const provider = createMockDurableExecutionProvider();
    const request = {
      workflowId: "workflow-1",
      workflowType: "test",
      input: null,
    } as const;
    await provider.startWorkflow(request);
    await expect(provider.startWorkflow(request)).rejects.toBeInstanceOf(
      DurableWorkflowAlreadyExistsError,
    );
    await expect(
      provider.queryWorkflow({ workflowId: "missing", queryName: "status" }),
    ).rejects.toBeInstanceOf(DurableWorkflowNotFoundError);

    await provider.terminateWorkflow({
      workflowId: "workflow-1",
      reason: "done",
    });
    await expect(
      provider.signalWorkflow({
        workflowId: "workflow-1",
        signalName: "late",
        payload: null,
      }),
    ).rejects.toThrow("Cannot signal a terminated durable workflow");
  });
});
