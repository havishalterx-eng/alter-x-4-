import type { ModelGatewayHandler } from "@alterx/adapters";
import type {
  CompilerCompileWorkflowRequest,
  RootCauseEstimate,
} from "@alterx/contracts";

import type { ApprovalsService } from "../approvals/approvals.service";
import type { RecoveryStrategy } from "./recovery-strategy-table";

/** Matches recovery_actions.outcome CHECK constraint exactly. */
export type RecoveryOutcome = "resolved" | "failed" | "escalated";

export interface DispatchContext {
  readonly tenantId: string; // bare UUID, already stripped of ten_
  readonly runId: string;
  readonly nodeExecutionId: string;
  readonly failureClass: string;
  readonly estimate: RootCauseEstimate;
}

export interface GraphCompilerHandler {
  compileWorkflow(
    request: CompilerCompileWorkflowRequest,
  ): Promise<{ readonly workflow_version_id: string }>;
}

export interface PlannerReplanHandler {
  replan(request: {
    readonly tenant_id: string;
    readonly run_id: string;
    readonly current_dag_json: string;
    readonly failure_context_json: string;
  }): Promise<{ readonly revised_skeleton_json: string; readonly reason: string }>;
}

export interface RecoveryRunReader {
  loadCompiledDagJson(
    tenantId: string,
    runId: string,
  ): Promise<{
    readonly compiledDagJson: string;
    readonly dagSchemaVersion: string;
    readonly workflowId: string;
  }>;
  writeTerminalFailed(tenantId: string, runId: string): Promise<void>;
}

export interface DispatchResult {
  readonly outcome: RecoveryOutcome;
  readonly detail: string;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled recovery strategy in dispatch: ${String(value)}`);
}

/**
 * Executes (or honestly declines to execute) the strategy HEAL-6's policy
 * table already selected. 5 of 10 strategies have a real target system
 * today; the other 5 are real, auditable decisions with no dispatch path
 * yet (see PR body) -- this never fakes a call to make a gap look closed.
 */
export class RecoveryDispatchService {
  constructor(
    private readonly modelGateway: ModelGatewayHandler,
    private readonly compiler: GraphCompilerHandler,
    private readonly planner: PlannerReplanHandler,
    private readonly approvals: ApprovalsService,
    private readonly runs: RecoveryRunReader,
  ) {}

  async dispatch(
    strategy: RecoveryStrategy,
    context: DispatchContext,
  ): Promise<DispatchResult> {
    switch (strategy) {
      case "escalate_model":
        return this.#escalateModel(context);
      case "replan":
        return this.#replan(context);
      case "degrade":
        return {
          outcome: "resolved",
          detail:
            "degraded output flagged via Synthesis stub (Output phase); presented as an explicit partial, never as complete",
        };
      case "ask_user":
        return this.#askUser(context);
      case "terminate":
        await this.runs.writeTerminalFailed(context.tenantId, context.runId);
        return { outcome: "failed", detail: "run terminated by recovery policy" };
      case "repair":
      case "retry":
      case "backoff":
      case "swap_agent":
      case "recompile":
        return {
          outcome: "escalated",
          detail: `strategy_dispatch_deferred: "${strategy}" has no real target system wired yet (see HEAL-6 PR known-gaps)`,
        };
      default:
        return assertNever(strategy);
    }
  }

  async #escalateModel(context: DispatchContext): Promise<DispatchResult> {
    try {
      const response = await this.modelGateway.invoke({
        tenant_id: `ten_${context.tenantId}`,
        run_id: context.runId,
        node_execution_id: context.nodeExecutionId,
        model_alias: "ADVANCED",
        input_json: JSON.stringify({
          task: "Re-attempt this node's output at a higher model tier after a logic/output failure.",
          failure_class: context.failureClass,
          root_cause: context.estimate,
        }),
      });
      return {
        outcome: "resolved",
        detail: `re-invoked via ${response.resolved_capability}`,
      };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        detail: `model escalation failed: ${(error as Error).message}`,
      };
    }
  }

  async #replan(context: DispatchContext): Promise<DispatchResult> {
    try {
      const { compiledDagJson, dagSchemaVersion, workflowId } =
        await this.runs.loadCompiledDagJson(context.tenantId, context.runId);
      const replanned = await this.planner.replan({
        tenant_id: `ten_${context.tenantId}`,
        run_id: context.runId,
        current_dag_json: compiledDagJson,
        failure_context_json: JSON.stringify({
          node_execution_id: context.nodeExecutionId,
          failure_class: context.failureClass,
          root_cause: context.estimate,
        }),
      });
      const compiled = await this.compiler.compileWorkflow({
        tenant_id: `ten_${context.tenantId}`,
        workflow_id: workflowId,
        task_skeleton_json: replanned.revised_skeleton_json,
        dag_schema_version: dagSchemaVersion,
      });
      return {
        outcome: "resolved",
        detail: `replanned; new workflow_version_id=${compiled.workflow_version_id} (${replanned.reason})`,
      };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        detail: `replan failed: ${(error as Error).message}`,
      };
    }
  }

  async #askUser(context: DispatchContext): Promise<DispatchResult> {
    try {
      const approval = await this.approvals.createPending({
        tenantId: `ten_${context.tenantId}`,
        runId: context.runId,
        nodeExecutionId: context.nodeExecutionId,
        requestedAction: {
          kind: "recovery_ask_user",
          failure_class: context.failureClass,
          root_cause: context.estimate,
        },
        expirySeconds: 86_400,
      });
      return {
        outcome: "escalated",
        detail: `approval ${approval.id} created, expires ${approval.expiryAt}`,
      };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        detail: `ask_user dispatch failed: ${(error as Error).message}`,
      };
    }
  }
}
