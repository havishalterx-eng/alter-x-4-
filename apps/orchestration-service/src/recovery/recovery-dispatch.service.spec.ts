import { describe, expect, it, vi } from "vitest";

import type { RootCauseEstimate } from "@alterx/contracts";

import {
  RecoveryDispatchService,
  type GraphCompilerHandler,
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
  return new RecoveryDispatchService(
    modelGateway as never,
    compiler,
    planner,
    approvals as never,
    runs,
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

  it("degrade always resolves via the honest Synthesis stub, never claims real synthesis", async () => {
    const service = buildService();
    const result = await service.dispatch("degrade", CONTEXT);
    expect(result.outcome).toBe("resolved");
    expect(result.detail).toContain("Synthesis stub");
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
