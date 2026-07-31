import { describe, expect, it, vi } from "vitest";

import type { RootCauseEstimate } from "@alterx/contracts";

import {
  RecoveryDispatchService,
  type GraphCompilerHandler,
  type NodeRetrySignaler,
  type PlannerReplanHandler,
  type RecoveryRunReader,
} from "./recovery-dispatch.service";
import { DISPATCHABLE_STRATEGIES, type RecoveryStrategy } from "./recovery-strategy-table";

const ALL_STRATEGIES: readonly RecoveryStrategy[] = [
  "repair",
  "retry",
  "backoff",
  "swap_agent",
  "escalate_model",
  "recompile",
  "replan",
  "degrade",
  "ask_user",
  "terminate",
];

const ESTIMATE: RootCauseEstimate = {
  schema_version: "heal5.v1",
  failure_class: "logic_output_failure",
  explanation: "test explanation",
  confidence: 0.8,
  evidence: ["evidence one"],
  node_attempt: 1,
  model_alias: "ADVANCED",
  resolved_capability: "ADVANCED:test",
};

const CONTEXT = {
  tenantId: "018f47a5-7b2c-7d10-8f11-123456789abc",
  runId: "run_018f47a5-7b2c-7d10-8f11-123456789abc",
  nodeExecutionId: "node_018f47a5-7b2c-7d10-8f11-123456789abc",
  nodeKey: "failed_node",
  failureClass: "logic_output_failure",
  estimate: ESTIMATE,
};

function buildService(overrides: {
  invoke?: (request: unknown) => Promise<unknown>;
  compileWorkflow?: GraphCompilerHandler["compileWorkflow"];
  replan?: PlannerReplanHandler["replan"];
  createPending?: (request: unknown) => Promise<{ readonly id: string; readonly expiryAt: string }>;
  loadCompiledDagJson?: RecoveryRunReader["loadCompiledDagJson"];
  writeTerminalFailed?: RecoveryRunReader["writeTerminalFailed"];
  signalWorkflow?: NodeRetrySignaler["signalWorkflow"];
  readValue?: (request: unknown) => Promise<unknown>;
  writeValue?: (request: unknown) => Promise<void>;
  findForSourceNode?: (request: unknown) => Promise<unknown[]>;
} = {}): RecoveryDispatchService {
  const modelGateway = {
    invoke:
      overrides.invoke ??
      vi.fn().mockResolvedValue({
        output_json: "{}",
        usage_json: "{}",
        resolved_capability: "ADVANCED:test",
      }),
  };
  const compiler: GraphCompilerHandler = {
    compileWorkflow:
      overrides.compileWorkflow ??
      vi.fn().mockResolvedValue({ workflow_version_id: "wfv_test" }),
  };
  const planner: PlannerReplanHandler = {
    replan:
      overrides.replan ??
      vi.fn().mockResolvedValue({
        revised_skeleton_json: "{}",
        reason: "test reason",
      }),
  };
  const approvals = {
    createPending:
      overrides.createPending ??
      vi.fn().mockResolvedValue({ id: "apr_test", expiryAt: "2026-01-01T00:00:00Z" }),
  };
  const runs: RecoveryRunReader = {
    loadCompiledDagJson:
      overrides.loadCompiledDagJson ??
      vi.fn().mockResolvedValue({
        compiledDagJson: "{}",
        dagSchemaVersion: "v1",
        workflowId: "wf_test",
      }),
    writeTerminalFailed: overrides.writeTerminalFailed ?? vi.fn().mockResolvedValue(undefined),
  };
  const nodeRetrySignaler: NodeRetrySignaler = {
    signalWorkflow: overrides.signalWorkflow ?? vi.fn().mockResolvedValue(undefined),
  };
  const blackboard = {
    readValue: overrides.readValue ?? vi.fn().mockResolvedValue(undefined),
    writeValue: overrides.writeValue ?? vi.fn().mockResolvedValue(undefined),
  };
  const verificationReader = {
    findForSourceNode: overrides.findForSourceNode ?? vi.fn().mockResolvedValue([]),
  };
  return new RecoveryDispatchService(
    modelGateway as never,
    compiler,
    planner,
    approvals as never,
    runs,
    nodeRetrySignaler,
    blackboard as never,
    verificationReader as never,
    // Real delay, kept tiny here so no test pays the real 5s default --
    // the dedicated backoff test below asserts the delay actually happens.
    5,
  );
}

describe("RecoveryDispatchService", () => {
  it("handles every one of the 10 locked strategy values without throwing (exhaustiveness guarantee)", async () => {
    const service = buildService();
    for (const strategy of ALL_STRATEGIES) {
      await expect(service.dispatch(strategy, CONTEXT)).resolves.toMatchObject({
        outcome: expect.stringMatching(/^(resolved|failed|escalated)$/),
      });
    }
  });

  it("honestly defers every non-dispatchable strategy instead of pretending to act", async () => {
    const service = buildService();
    for (const strategy of ALL_STRATEGIES) {
      if (DISPATCHABLE_STRATEGIES.has(strategy)) continue;
      const result = await service.dispatch(strategy, CONTEXT);
      expect(result.outcome).toBe("escalated");
      expect(result.detail).toContain("strategy_dispatch_deferred");
    }
  });

  it("escalate_model calls Model Gateway at ADVANCED tier and resolves", async () => {
    const invoke = vi.fn().mockResolvedValue({
      output_json: "{}",
      usage_json: "{}",
      resolved_capability: "ADVANCED:anthropic.claude",
    });
    const service = buildService({ invoke });
    const result = await service.dispatch("escalate_model", CONTEXT);
    expect(result.outcome).toBe("resolved");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ model_alias: "ADVANCED" }),
    );
  });

  it("escalate_model fails (not throws) when Model Gateway errors", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("gateway unreachable"));
    const service = buildService({ invoke });
    const result = await service.dispatch("escalate_model", CONTEXT);
    expect(result.outcome).toBe("failed");
  });

  it("replan loads the compiled DAG, calls Planner, then recompiles", async () => {
    const loadCompiledDagJson = vi.fn().mockResolvedValue({
      compiledDagJson: '{"schema_version":"v1"}',
      dagSchemaVersion: "v1",
      workflowId: "wf_real",
    });
    const replan = vi.fn().mockResolvedValue({
      revised_skeleton_json: '{"steps":[]}',
      reason: "logic failure detected",
    });
    const compileWorkflow = vi.fn().mockResolvedValue({ workflow_version_id: "wfv_new" });
    const service = buildService({ loadCompiledDagJson, replan, compileWorkflow });

    const result = await service.dispatch("replan", CONTEXT);

    expect(result.outcome).toBe("resolved");
    expect(replan).toHaveBeenCalledWith(
      expect.objectContaining({
        run_id: CONTEXT.runId,
        current_dag_json: '{"schema_version":"v1"}',
      }),
    );
    expect(compileWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "wf_real",
        task_skeleton_json: '{"steps":[]}',
        dag_schema_version: "v1",
      }),
    );
  });

  it("replan fails (not throws) when the run has no compiled DAG to replan from", async () => {
    const loadCompiledDagJson = vi.fn().mockRejectedValue(new Error("no compiled DAG"));
    const service = buildService({ loadCompiledDagJson });
    const result = await service.dispatch("replan", CONTEXT);
    expect(result.outcome).toBe("failed");
  });

  it("recompile shares replan's real mechanism (no narrower primitive exists)", async () => {
    const replan = vi.fn().mockResolvedValue({
      revised_skeleton_json: '{"steps":[]}',
      reason: "sandbox crash detected",
    });
    const compileWorkflow = vi.fn().mockResolvedValue({ workflow_version_id: "wfv_recompiled" });
    const service = buildService({ replan, compileWorkflow });

    const result = await service.dispatch("recompile", CONTEXT);

    expect(result.outcome).toBe("resolved");
    expect(replan).toHaveBeenCalledTimes(1);
    expect(compileWorkflow).toHaveBeenCalledTimes(1);
  });

  it("retry sends a real nodeRetryDecidedSignal to the run's Executor workflow", async () => {
    const signalWorkflow = vi.fn().mockResolvedValue(undefined);
    const service = buildService({ signalWorkflow });

    const result = await service.dispatch("retry", CONTEXT);

    expect(result.outcome).toBe("resolved");
    expect(signalWorkflow).toHaveBeenCalledWith({
      workflowId: CONTEXT.runId,
      signalName: "nodeRetryDecided",
      payload: { nodeExecutionId: CONTEXT.nodeExecutionId, action: "retry" },
    });
  });

  it("retry fails (not throws) when signaling the workflow fails", async () => {
    const signalWorkflow = vi.fn().mockRejectedValue(new Error("workflow not found"));
    const service = buildService({ signalWorkflow });

    const result = await service.dispatch("retry", CONTEXT);

    expect(result.outcome).toBe("failed");
  });

  it("backoff sends the same real signal as retry, after a real (injectable, here tiny) delay", async () => {
    const signalWorkflow = vi.fn().mockResolvedValue(undefined);
    const service = new RecoveryDispatchService(
      { invoke: vi.fn() } as never,
      { compileWorkflow: vi.fn() } as never,
      { replan: vi.fn() } as never,
      { createPending: vi.fn() } as never,
      {
        loadCompiledDagJson: vi.fn(),
        writeTerminalFailed: vi.fn(),
      } as never,
      { signalWorkflow },
      { readValue: vi.fn(), writeValue: vi.fn() } as never,
      { findForSourceNode: vi.fn() } as never,
      25, // real delay, injected small so the test doesn't burn 5 real seconds
    );

    const start = Date.now();
    const result = await service.dispatch("backoff", CONTEXT);
    const elapsedMs = Date.now() - start;

    expect(result.outcome).toBe("resolved");
    expect(elapsedMs).toBeGreaterThanOrEqual(20);
    expect(signalWorkflow).toHaveBeenCalledWith({
      workflowId: CONTEXT.runId,
      signalName: "nodeRetryDecided",
      payload: { nodeExecutionId: CONTEXT.nodeExecutionId, action: "retry" },
    });
  });

  describe("degrade", () => {
    const DAG_JSON = JSON.stringify({
      schema_version: "dag-v1",
      entry_node_keys: ["node_a", "node_b"],
      nodes: [
        { key: "node_a", type: "LLMTask", config: {}, metadata: { ui: {} } },
        { key: "node_b", type: "LLMTask", config: {}, metadata: { ui: {} } },
        { key: CONTEXT.nodeKey, type: "Synthesis", config: {}, metadata: { ui: {} } },
      ],
      edges: [
        { key: "e1", from: "node_a", to: CONTEXT.nodeKey, kind: "sequential" },
        { key: "e2", from: "node_b", to: CONTEXT.nodeKey, kind: "sequential" },
      ],
      waves: [
        { key: "w0", order: 0, node_keys: ["node_a", "node_b"], depends_on: [] },
        { key: "w1", order: 1, node_keys: [CONTEXT.nodeKey], depends_on: ["w0"] },
      ],
    });
    const PASS = { gateType: "quality", verdict: "pass", score: 0.9, threshold: 0.7, details: {} };
    const SAFE = {
      gateType: "safety",
      verdict: "pass",
      score: null,
      threshold: null,
      details: { severity: "low" },
    };

    it("synthesizes a real honest partial from verified predecessor outputs and writes it to the failed node's own Blackboard key", async () => {
      const readValue = vi.fn().mockImplementation((request: { key: string }) => {
        if (request.key === "node_a") return Promise.resolve({ text: "a" });
        return Promise.resolve(undefined);
      });
      const writeValue = vi.fn().mockResolvedValue(undefined);
      const invoke = vi.fn().mockResolvedValue({
        output_json: JSON.stringify({ summary: "partial" }),
        usage_json: "{}",
        resolved_capability: "ADVANCED:test",
      });
      const service = buildService({
        loadCompiledDagJson: vi.fn().mockResolvedValue({
          compiledDagJson: DAG_JSON,
          dagSchemaVersion: "dag-v1",
          workflowId: "wf_test",
        }),
        readValue,
        writeValue,
        invoke,
        findForSourceNode: vi.fn().mockResolvedValue([PASS, SAFE]),
      });

      const result = await service.dispatch("degrade", CONTEXT);

      expect(result.outcome).toBe("resolved");
      expect(writeValue).toHaveBeenCalledWith(
        expect.objectContaining({
          key: CONTEXT.nodeKey,
          value: expect.objectContaining({ deliverable: { summary: "partial" } }),
        }),
      );
    });

    it("escalates (never fakes resolved) when no predecessor has a Blackboard value", async () => {
      const service = buildService({
        loadCompiledDagJson: vi.fn().mockResolvedValue({
          compiledDagJson: DAG_JSON,
          dagSchemaVersion: "dag-v1",
          workflowId: "wf_test",
        }),
        readValue: vi.fn().mockResolvedValue(undefined),
      });

      const result = await service.dispatch("degrade", CONTEXT);

      expect(result.outcome).toBe("escalated");
    });

    it("escalates when Synthesis itself finds nothing verified, never claims resolved", async () => {
      const readValue = vi.fn().mockResolvedValue({ text: "a" });
      const service = buildService({
        loadCompiledDagJson: vi.fn().mockResolvedValue({
          compiledDagJson: DAG_JSON,
          dagSchemaVersion: "dag-v1",
          workflowId: "wf_test",
        }),
        readValue,
        // Every predecessor's input fails verification -- nothing honest to synthesize.
        findForSourceNode: vi.fn().mockResolvedValue([]),
      });

      const result = await service.dispatch("degrade", CONTEXT);

      expect(result.outcome).toBe("escalated");
    });

    it("fails (not resolved, not a crash) when the compiled DAG is invalid", async () => {
      const service = buildService({
        loadCompiledDagJson: vi.fn().mockResolvedValue({
          compiledDagJson: "not valid json",
          dagSchemaVersion: "dag-v1",
          workflowId: "wf_test",
        }),
      });

      const result = await service.dispatch("degrade", CONTEXT);

      expect(result.outcome).toBe("failed");
    });
  });

  it("ask_user creates a real pending approval and escalates", async () => {
    const createPending = vi
      .fn()
      .mockResolvedValue({ id: "apr_real", expiryAt: "2026-02-01T00:00:00Z" });
    const service = buildService({ createPending });
    const result = await service.dispatch("ask_user", CONTEXT);
    expect(result.outcome).toBe("escalated");
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({ nodeExecutionId: CONTEXT.nodeExecutionId }),
    );
  });

  it("terminate writes the real terminal run state and reports failed", async () => {
    const writeTerminalFailed = vi.fn().mockResolvedValue(undefined);
    const service = buildService({ writeTerminalFailed });
    const result = await service.dispatch("terminate", CONTEXT);
    expect(result.outcome).toBe("failed");
    expect(writeTerminalFailed).toHaveBeenCalledWith(CONTEXT.tenantId, CONTEXT.runId);
  });
});
