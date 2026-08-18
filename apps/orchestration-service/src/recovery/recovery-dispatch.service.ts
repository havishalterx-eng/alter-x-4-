import type { ModelGatewayHandler } from "@alterx/adapters";
import type {
  CompiledDag,
  CompilerCompileWorkflowRequest,
  RootCauseEstimate,
} from "@alterx/contracts";
import { CompiledDagSchema } from "@alterx/contracts";

import type { JsonValue } from "@alterx/shared-clients";

import type { ApprovalsService } from "../approvals/approvals.service";
import type { BlackboardService } from "../blackboard/blackboard.service";
import { SynthesisHandler } from "../registry/handlers/synthesis.handler";
import type { VerificationGateReader } from "../registry/verification-gate-reader";
import type { RecoveryStrategy } from "./recovery-strategy-table";

/** Matches recovery_actions.outcome CHECK constraint exactly. */
export type RecoveryOutcome = "resolved" | "failed" | "escalated";

export interface DispatchContext {
  readonly tenantId: string; // bare UUID, already stripped of ten_
  readonly runId: string;
  readonly nodeExecutionId: string;
  readonly nodeKey: string; // real dag_node_id of the failed node
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
    readonly workspaceId: string;
  }>;
  writeTerminalFailed(tenantId: string, runId: string): Promise<void>;
}

/** Same generic shape as ApprovalDecisionSignaler (approvals.service.ts). */
export interface NodeRetrySignaler {
  signalWorkflow(request: {
    readonly workflowId: string;
    readonly signalName: string;
    readonly payload: unknown;
  }): Promise<void>;
}

export interface DispatchResult {
  readonly outcome: RecoveryOutcome;
  readonly detail: string;
}

export interface CapabilityResolverHandler {
  resolveNodeRequirements(request: {
    readonly tenant_id: string;
    readonly run_id: string;
    readonly node_key: string;
    readonly node_type: string;
    readonly node_config_json: string;
  }): Promise<{ readonly node_requirements_json: string; readonly schema_version: string }>;
}

export interface SelectionBindingHandler {
  bindAgentModelTool(request: {
    readonly tenant_id: string;
    readonly run_id: string;
    readonly node_key: string;
    readonly node_requirements_json: string;
    readonly workspace_id: string;
    readonly node_type: string;
  }): Promise<
    | {
        readonly matched: true;
        readonly agent_id: string;
        readonly agent_version: number;
      }
    | { readonly matched: false; readonly reason: string }
  >;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled recovery strategy in dispatch: ${String(value)}`);
}

/** Same shape as executor-workflow.ts's own `directPredecessorKeys` --
 * small pure function, re-derived here rather than shared to keep this
 * ticket's blast radius to the recovery module alone (same disclosed
 * duplication pattern gate.handler.ts/synthesis.handler.ts already use
 * for classifyVerification). */
function directPredecessorKeys(dag: CompiledDag, nodeKey: string): string[] {
  return dag.edges.filter((edge) => edge.to === nodeKey).map((edge) => edge.from);
}

/**
 * Executes (or honestly declines to execute) the strategy HEAL-6's policy
 * table already selected. 5 of 10 strategies have a real target system
 * today; the other 5 are real, auditable decisions with no dispatch path
 * yet (see PR body) -- this never fakes a call to make a gap look closed.
 */
const DEFAULT_BACKOFF_DELAY_MS = 5_000;

export class RecoveryDispatchService {
  constructor(
    private readonly modelGateway: ModelGatewayHandler,
    private readonly compiler: GraphCompilerHandler,
    private readonly planner: PlannerReplanHandler,
    private readonly approvals: ApprovalsService,
    private readonly runs: RecoveryRunReader,
    private readonly nodeRetrySignaler: NodeRetrySignaler,
    private readonly blackboard: BlackboardService,
    private readonly verificationReader: VerificationGateReader,
    private readonly backoffDelayMs: number = DEFAULT_BACKOFF_DELAY_MS,
    private readonly capabilityResolver?: CapabilityResolverHandler,
    private readonly selectionBinding?: SelectionBindingHandler,
  ) {}

  async dispatch(
    strategy: RecoveryStrategy,
    context: DispatchContext,
  ): Promise<DispatchResult> {
    switch (strategy) {
      case "escalate_model":
        return this.#escalateModel(context);
      case "replan":
      case "recompile":
        // No narrower "recompile without a new plan" primitive exists --
        // GraphCompilerService.compileWorkflow always needs a task
        // skeleton, and only Planner produces one. Disclosed merge
        // (Self-Healing exit-check closure): both strategies share this
        // one real mechanism today, never faked as two independent paths.
        return this.#replan(context);
      case "degrade":
        return this.#degrade(context);
      case "ask_user":
        return this.#askUser(context);
      case "terminate":
        await this.runs.writeTerminalFailed(context.tenantId, context.runId);
        return { outcome: "failed", detail: "run terminated by recovery policy" };
      case "retry":
        return this.#retryNode(context, { withBackoff: false });
      case "backoff":
        return this.#retryNode(context, { withBackoff: true });
      case "repair":
        // Still has no defined concept anywhere in the codebase.
        return {
          outcome: "escalated",
          detail: 'strategy_dispatch_deferred: "repair" has no real target system wired yet (see HEAL-6 PR known-gaps)',
        };
      case "swap_agent":
        return this.#swapAgent(context);
      default:
        return assertNever(strategy);
    }
  }

  /**
   * OUT-3: real target for "degrade" -- previously a hardcoded stub that
   * always claimed "resolved" without ever calling Synthesis (see git
   * history / HEAL-6 PR A's disclosed known-gap).
   *
   * Reads the failed node's real direct predecessors from the compiled
   * DAG (same `directPredecessorKeys` logic executor-workflow.ts already
   * uses), fetches their real outputs from the Blackboard (same source
   * every other node reads from -- EXEC-5/EXEC-7), and asks
   * `SynthesisHandler` (OUT-2) to assemble an honest partial from
   * whichever of them verified. The result -- deliverable + gaps,
   * `degraded: true` -- is written to the Blackboard under the *failed*
   * node's own key, so anything downstream that depends on it reads a
   * flagged partial instead of nothing. `recovery_actions` has no column
   * for a rich result (checked: only strategy/policy_version/outcome),
   * so the Blackboard is the real, correct home for it -- matches how
   * every other node's output already gets there.
   *
   * If Synthesis itself reports nothing verified
   * (`execution_status: "blocked_pending_recovery"`), there is nothing
   * honest to degrade into -- this returns "escalated", never a fake
   * "resolved", so HEAL-8's run_outcomes mapping doesn't record a
   * degraded verdict for a run that produced no real partial at all.
   */
  async #degrade(context: DispatchContext): Promise<DispatchResult> {
    try {
      const { compiledDagJson } = await this.runs.loadCompiledDagJson(
        context.tenantId,
        context.runId,
      );
      const parsed = CompiledDagSchema.safeParse(JSON.parse(compiledDagJson));
      if (!parsed.success) {
        return { outcome: "failed", detail: "degrade failed: compiled DAG is invalid" };
      }
      const predecessorKeys = directPredecessorKeys(parsed.data, context.nodeKey);

      const inputs: Record<string, Record<string, unknown>> = {};
      await Promise.all(
        predecessorKeys.map(async (predecessorKey) => {
          const value = await this.blackboard.readValue({
            tenantId: `ten_${context.tenantId}`,
            runId: context.runId,
            key: predecessorKey,
          });
          if (value !== undefined && typeof value === "object" && !Array.isArray(value)) {
            inputs[predecessorKey] = value as Record<string, unknown>;
          }
        }),
      );

      if (Object.keys(inputs).length === 0) {
        return {
          outcome: "escalated",
          detail: "degrade found no predecessor outputs on the Blackboard to synthesize from",
        };
      }

      const synthesis = new SynthesisHandler(this.modelGateway, this.verificationReader);
      const result = await synthesis.execute({
        tenant_id: `ten_${context.tenantId}`,
        run_id: context.runId,
        node_execution_id: context.nodeExecutionId,
        config: {},
        inputs,
      });

      if (result.metadata?.["execution_status"] === "blocked_pending_recovery") {
        return {
          outcome: "escalated",
          detail: "degrade: no upstream input passed verification, nothing honest to synthesize",
        };
      }

      await this.blackboard.writeValue({
        tenantId: `ten_${context.tenantId}`,
        runId: context.runId,
        key: context.nodeKey,
        // Real, JSON-safe at runtime (SynthesisHandler's output is either
        // a parsed Model Gateway JSON response or the plain gaps/no-input
        // literal shape) -- BlackboardWriteRequest's recursive JsonValue
        // type can't structurally match Record<string, unknown> though.
        value: result.output as unknown as JsonValue,
      });

      const gapCount = Array.isArray(result.output["gaps"]) ? result.output["gaps"].length : 0;
      return {
        outcome: "resolved",
        detail: `degraded output synthesized and flagged (${gapCount} gap${gapCount === 1 ? "" : "s"}), written to node_key=${context.nodeKey}`,
      };
    } catch (error: unknown) {
      return { outcome: "failed", detail: `degrade failed: ${(error as Error).message}` };
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

  /**
   * Real dispatch target confirmed: Selection & Binding's ranked-match
   * path (GrpcEmbeddingClient) is real and reachable. But no node
   * execution anywhere -- normal or recovery path -- reads a bound
   * agent_id back out; NodeExecutionContext has no agent_id field at all
   * (confirmed by grepping every node handler). A successful match here
   * therefore has nothing downstream that could apply it to the retry,
   * so this never reports "resolved" for a fix that wouldn't actually
   * take effect -- same standard #degrade's own comment holds itself to.
   * The real match/no-match result is still surfaced in `detail` for
   * observability, and is a real, live call, not a stub.
   */
  async #swapAgent(context: DispatchContext): Promise<DispatchResult> {
    if (this.capabilityResolver === undefined || this.selectionBinding === undefined) {
      return {
        outcome: "escalated",
        detail: 'strategy_dispatch_deferred: "swap_agent" has no capability resolver / selection binding configured',
      };
    }
    try {
      const { compiledDagJson, workspaceId } = await this.runs.loadCompiledDagJson(
        context.tenantId,
        context.runId,
      );
      const parsed = CompiledDagSchema.safeParse(JSON.parse(compiledDagJson));
      if (!parsed.success) {
        return { outcome: "escalated", detail: "swap_agent failed: compiled DAG is invalid" };
      }
      const node = parsed.data.nodes.find((candidate) => candidate.key === context.nodeKey);
      if (node === undefined) {
        return {
          outcome: "escalated",
          detail: `swap_agent failed: node ${context.nodeKey} not found in the compiled DAG`,
        };
      }

      const resolved = await this.capabilityResolver.resolveNodeRequirements({
        tenant_id: `ten_${context.tenantId}`,
        run_id: context.runId,
        node_key: context.nodeKey,
        node_type: node.type,
        node_config_json: JSON.stringify(node.config),
      });

      const outcome = await this.selectionBinding.bindAgentModelTool({
        tenant_id: `ten_${context.tenantId}`,
        run_id: context.runId,
        node_key: context.nodeKey,
        node_requirements_json: resolved.node_requirements_json,
        workspace_id: `ws_${workspaceId}`,
        node_type: node.type,
      });

      if (outcome.matched) {
        return {
          outcome: "escalated",
          detail:
            `swap_agent found a real eligible replacement (agent ${outcome.agent_id} ` +
            `v${outcome.agent_version}) via ranked-match, but no execution-time ` +
            "binding-consumption path exists yet to apply it to the retry",
        };
      }
      return {
        outcome: "escalated",
        detail: `swap_agent found no eligible replacement agent (${outcome.reason})`,
      };
    } catch (error: unknown) {
      return {
        outcome: "escalated",
        detail: `swap_agent ranked-match attempt failed: ${(error as Error).message}`,
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

  /**
   * Real target: nodeRetryDecidedSignal on the run's Executor workflow
   * (executor-workflow.ts, Self-Healing exit-check closure). `runId` is
   * the workflow's own workflowId (RunLauncherService starts it with
   * workflowId: row.id) -- `nodeExecutionId` here is the exact same ID
   * the workflow's condition() wait is keyed on, since it originated from
   * that same node's real executeNode call.
   *
   * `backoff` is a real fixed delay (backoffDelayMs, default 5s, injectable
   * for tests) before sending the signal, run
   * here in normal Node.js code (not Temporal workflow code, so a plain
   * setTimeout is safe) -- disclosed interim behavior: this blocks the
   * SelectStrategy RPC response for the delay duration rather than using
   * an external delayed-job mechanism, acceptable for a first real
   * implementation, not a permanent design commitment.
   */
  async #retryNode(
    context: DispatchContext,
    options: { readonly withBackoff: boolean },
  ): Promise<DispatchResult> {
    try {
      if (options.withBackoff) {
        await new Promise((resolve) => setTimeout(resolve, this.backoffDelayMs));
      }
      await this.nodeRetrySignaler.signalWorkflow({
        workflowId: context.runId,
        signalName: "nodeRetryDecided",
        payload: { nodeExecutionId: context.nodeExecutionId, action: "retry" },
      });
      return {
        outcome: "resolved",
        detail: `${options.withBackoff ? "backoff" : "retry"} signal sent for node_execution_id=${context.nodeExecutionId}`,
      };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        detail: `${options.withBackoff ? "backoff" : "retry"} dispatch failed: ${(error as Error).message}`,
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
