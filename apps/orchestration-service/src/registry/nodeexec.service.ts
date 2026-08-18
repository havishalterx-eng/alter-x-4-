import type {
  NodeexecExecuteNodeRequest,
  NodeexecExecuteNodeResponse,
  NodeexecFinalizeApprovalNodeRequest,
  NodeexecFinalizeApprovalNodeResponse,
  NodeexecFinalizeRunRequest,
  NodeexecFinalizeRunResponse,
} from "@alterx/contracts";
import {
  GENERATED_FILES_OUTPUT_INSTRUCTION,
  ModelAliasSchema,
  NodeTypeSchema,
  ProblemDetailsSchema,
  type NodeType,
} from "@alterx/contracts";

import type {
  CapabilityServiceHandlerClient,
  PerformanceRecorderHandler,
  SelectionBindingHandler,
} from "@alterx/adapters";

import { NodeHandlerValidationError } from "./handler";
import type { NodeHandlerRegistry } from "./node-handler-registry";
import { NodeExecutionLedgerService } from "../runs/node-execution-ledger.service";
import { RunStreamEventService } from "../runs/run-stream-event.service";
import type { RecoveryTriggerService } from "../recovery/recovery-trigger.service";
import type { RunOutcomeService } from "../runs/run-outcome.service";
import type { ProjectRunProvisioningService } from "../runs/project-run-provisioning.service";
import type { RunWorkspaceLookupService } from "../runs/run-workspace-lookup.service";
import type { GeneratedFileMaterializer } from "./generated-file-materializer";
import { VerifyGateError, type VerifyGateService } from "./verify-gate.service";
import { createVerificationResultId } from "./verification-result-id";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(json: string, field: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error: unknown) {
    throw new NodeHandlerValidationError(
      `${field} is not valid JSON: ${(error as Error).message}`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new NodeHandlerValidationError(`${field} must parse to an object`);
  }
  return parsed;
}

function parseInputs(json: string): Record<string, Record<string, unknown>> {
  const raw = parseJsonObject(json, "inputs_json");
  const inputs: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw)) {
    inputs[key] = isPlainObject(value) ? value : {};
  }
  return inputs;
}

function isGeneratedFileNode(request: NodeexecExecuteNodeRequest): boolean {
  return request.node_type === "LLMTask" && request.node_key === "node_generate_code";
}

function withGeneratedFileInstruction(
  config: Record<string, unknown>,
  generatedFileNode: boolean,
): Record<string, unknown> {
  if (!generatedFileNode || typeof config["prompt"] !== "string") return config;
  return {
    ...config,
    prompt: `${config["prompt"]}\n\n${GENERATED_FILES_OUTPUT_INSTRUCTION}`,
  };
}

/**
 * gRPC-facing NodeexecHandler. The Executor reaches every handler through
 * this boundary, so it owns the minimal durable node-executions ledger:
 * started before dispatch; succeeded/failed after dispatch. Full run
 * lifecycle and artifact output references remain EXEC-14 scope.
 */
export class NodeexecService {
  constructor(
    private readonly registry: NodeHandlerRegistry,
    private readonly ledger: NodeExecutionLedgerService,
    private readonly streamEvents?: RunStreamEventService,
    private readonly recovery?: RecoveryTriggerService,
    private readonly runOutcomes?: RunOutcomeService,
    private readonly projectProvisioning?: ProjectRunProvisioningService,
    private readonly generatedFileMaterializer?: GeneratedFileMaterializer,
    private readonly verifyGate?: VerifyGateService,
    private readonly runWorkspaceLookup?: RunWorkspaceLookupService,
    private readonly capabilityResolver?: CapabilityServiceHandlerClient,
    private readonly selectionBinding?: SelectionBindingHandler,
    private readonly performanceRecorder?: PerformanceRecorderHandler,
  ) {}

  async executeNode(
    request: NodeexecExecuteNodeRequest,
  ): Promise<NodeexecExecuteNodeResponse> {
    if (request.node_key.trim().length === 0) {
      throw new NodeHandlerValidationError("node_key is required");
    }
    if (request.node_type.trim().length === 0) {
      throw new NodeHandlerValidationError("node_type is required");
    }
    const nodeType = NodeTypeSchema.safeParse(request.node_type);
    if (!nodeType.success) {
      throw new NodeHandlerValidationError("node_type is not recognized");
    }

    const inputRef = safeInputRef(request.inputs_json);
    const started = await this.ledger.recordStarted({
      tenantId: request.tenant_id,
      runId: request.run_id,
      nodeExecutionId: request.node_execution_id,
      dagNodeId: request.node_key,
      nodeType: request.node_type,
      ...(inputRef === undefined ? {} : { inputRef }),
      ...modelAliasFromConfigJson(request.config_json),
    });
    await this.#ensureRunStatusBestEffort(request);
    await this.#appendBestEffort({
      event: "node.started",
      data: {
        node_execution_id: request.node_execution_id,
        dag_node_key: request.node_key,
        node_type: nodeType.data,
        attempt: started.attempt,
        started_at: started.startedAt,
      },
    }, request);

    let boundAgentId: string | undefined;
    let executedMetadata: Record<string, unknown> | undefined;
    const executionStartedAtMs = Date.now();
    try {
      const config = parseJsonObject(request.config_json, "config_json");
      const inputs = parseInputs(request.inputs_json);
      const generatedFileNode = isGeneratedFileNode(request);
      const configuredSandboxSessionId = config["sandbox_session_id"];
      const sandboxSessionId =
        typeof configuredSandboxSessionId === "string"
          ? configuredSandboxSessionId
          : configuredSandboxSessionId === undefined &&
              (generatedFileNode || request.node_type === "SandboxExec")
            ? await this.projectProvisioning?.getSessionForRun(
                request.tenant_id,
                request.run_id,
              )
            : undefined;
      const executionConfig = withGeneratedFileInstruction(
        sandboxSessionId !== undefined && configuredSandboxSessionId === undefined
          ? { ...config, sandbox_session_id: sandboxSessionId }
          : config,
        generatedFileNode,
      );
      const agentBinding = await this.#resolveAgentBindingBestEffort(request, executionConfig);
      boundAgentId = agentBinding.agent_id;
      const result = await this.registry.execute(request.node_type, {
        config: executionConfig,
        inputs,
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_execution_id: request.node_execution_id,
        ...(typeof sandboxSessionId === "string"
          ? { sandbox_session_id: sandboxSessionId }
          : {}),
        ...agentBinding,
        on_model_delta: async (delta, index, final) =>
          this.#appendBestEffort({
            event: "model.delta",
            data: { node_execution_id: request.node_execution_id, delta, index, final },
          }, request),
      });

      executedMetadata = result.metadata;
      if (request.node_type === "SandboxExec") {
        await this.#appendTerminalFramesBestEffort(request, result.output);
      }

      const outputJson = JSON.stringify(result.output);
      let metadata = result.metadata ?? {};

      if (result.metadata?.["execution_status"] === "blocked_pending_recovery") {
        const reason = String(result.output["reason"] ?? "verification blocked external action");
        await this.ledger.recordBlockedPendingRecovery(
          { tenantId: request.tenant_id, runId: request.run_id, nodeExecutionId: request.node_execution_id },
          reason,
        );
        await this.#triggerRecoveryBestEffort(request, reason);
        return { output_json: outputJson, metadata_json: JSON.stringify(metadata) };
      }

      if (result.metadata?.["execution_status"] === "pending_approval") {
        // HEAL-7: this node_execution is not done -- it stays 'running'
        // until FinalizeApprovalNode resolves it. Do not call recordSucceeded/
        // recordFailed, which would prematurely mark it terminal. Reuses
        // the Foundation-phase "approval.requested" SSE contract.
        const approvalId = result.output["approval_id"];
        const expiryAt = result.output["expiry_at"];
        if (typeof approvalId === "string" && typeof expiryAt === "string") {
          await this.#appendBestEffort({
            event: "approval.requested",
            data: {
              approval_id: approvalId,
              node_execution_id: request.node_execution_id,
              requested_action: config,
              requested_at: new Date().toISOString(),
              expiry_at: expiryAt,
            },
          }, request);
        }
        return { output_json: outputJson, metadata_json: JSON.stringify(metadata) };
      }

      const problem = ProblemDetailsSchema.safeParse(result.output);
      if (problem.success && problem.data.status >= 400) {
        await this.ledger.recordFailed(
          {
            tenantId: request.tenant_id,
            runId: request.run_id,
            nodeExecutionId: request.node_execution_id,
          },
          problem.data,
        );
        await this.#appendBestEffort(failedEvent(request, nodeType.data, started.attempt, {
          error_code: problem.data.error_code,
          message: problem.data.detail,
          retryable: problem.data.retryable,
        }), request);
        await this.#recordPerformanceBestEffort(
          request, boundAgentId, "failure", executionStartedAtMs, executedMetadata,
        );
      } else {
        const verification = await this.verifyGate?.scoreNodeInline({
          tenant_id: request.tenant_id,
          run_id: request.run_id,
          node_execution_id: request.node_execution_id,
          node_key: request.node_key,
          node_type: request.node_type,
          config_json: JSON.stringify(executionConfig),
          output_json: outputJson,
        });
        if (verification !== undefined) {
          await this.ledger.recordVerificationResult({
            id: createVerificationResultId(),
            tenantId: request.tenant_id,
            runId: request.run_id,
            nodeExecutionId: request.node_execution_id,
            gateType: "quality",
            verdict: verification.verdict,
            score: verification.score,
            threshold: verification.threshold,
            reviewerModel: verification.reviewer_model,
            detailsJson: verification.details_json,
          });
          metadata = {
            ...metadata,
            verification: {
              verdict: verification.verdict,
              score: verification.score,
              threshold: verification.threshold,
              reviewer_model: verification.reviewer_model,
            },
          };
          if (verification.verdict === "fail") {
            throw new VerifyGateError(
              "VERIFICATION_GATE_FAILED",
              "Verify Gate rejected node output",
            );
          }
        }
        const outputRef = generatedFileNode
          ? await this.#materializeGeneratedFiles(request, sandboxSessionId, result.output)
          : undefined;
        await this.ledger.recordSucceeded({
          tenantId: request.tenant_id,
          runId: request.run_id,
          nodeExecutionId: request.node_execution_id,
          ...(outputRef === undefined ? {} : { outputRef }),
        });
        await this.#appendBestEffort({ event: "node.completed", data: {
          node_execution_id: request.node_execution_id, dag_node_key: request.node_key,
          node_type: nodeType.data, attempt: started.attempt,
          status: "succeeded", ended_at: new Date().toISOString(),
          ...(verification === undefined ? {} : { verification_verdict: verification.verdict }),
        } }, request);
        await this.#recordPerformanceBestEffort(
          request, boundAgentId, "success", executionStartedAtMs, executedMetadata,
        );
      }
      return { output_json: outputJson, metadata_json: JSON.stringify(metadata) };
    } catch (error: unknown) {
      const failure = persistedError(error);
      await this.ledger.recordFailed(
        {
          tenantId: request.tenant_id,
          runId: request.run_id,
          nodeExecutionId: request.node_execution_id,
        },
        failure,
      );
      await this.#appendBestEffort(failedEvent(request, nodeType.data, started.attempt, {
        error_code: "NODE_EXECUTION_FAILED", message: "Node execution failed", retryable: false,
      }), request);
      await this.#recordPerformanceBestEffort(
        request, boundAgentId, "failure", executionStartedAtMs, executedMetadata,
      );
      await this.#triggerRecoveryForFailureBestEffort(request, failure);
      throw error;
    }
  }

  /**
   * Selection & Binding is resolved fresh here, per LLMTask node, rather
   * than baked into the compiled DAG at plan time -- same runtime-injection
   * shape as sandboxSessionId above, so a swap_agent retry (recovery-
   * dispatch.service.ts) is picked up by the very next execution without
   * recompiling the workflow. Fail-open: LLMTaskHandler falls back to its
   * own compiled config.model_alias whenever this returns {}, whether that's
   * because deps aren't configured, no eligible agent matched, or a real
   * call failed -- a missing binding must never fail the node.
   */
  async #resolveAgentBindingBestEffort(
    request: NodeexecExecuteNodeRequest,
    config: Record<string, unknown>,
  ): Promise<{
    readonly agent_id?: string;
    readonly bound_model_alias?: string;
    readonly bound_tool_names?: readonly string[];
  }> {
    if (
      request.node_type !== "LLMTask" ||
      this.runWorkspaceLookup === undefined ||
      this.capabilityResolver === undefined ||
      this.selectionBinding === undefined
    ) {
      return {};
    }
    try {
      const workspaceId = await this.runWorkspaceLookup.getWorkspaceId(
        request.tenant_id,
        request.run_id,
      );
      const requirements = await this.capabilityResolver.resolveNodeRequirements({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_key: request.node_key,
        node_type: request.node_type,
        node_config_json: JSON.stringify(config),
      });
      const bound = await this.selectionBinding.bindAgentModelTool({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_key: request.node_key,
        node_requirements_json: requirements.node_requirements_json,
        workspace_id: workspaceId,
        node_type: request.node_type,
      });
      if (!bound.matched) return {};
      return {
        agent_id: bound.agent_id,
        bound_model_alias: bound.model_alias,
        bound_tool_names: bound.tool_names,
      };
    } catch (error: unknown) {
      console.error("selection & binding resolution failed for LLMTask node", {
        node_execution_id: request.node_execution_id,
        run_id: request.run_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * The real performance_records writer call -- only fires when a real
   * Selection & Binding match happened (agentId defined), so this never
   * attributes performance to a compiled-config model_alias with no agent
   * identity behind it. Best-effort: a recording failure must never affect
   * the node's already-decided success/failure outcome.
   */
  async #recordPerformanceBestEffort(
    request: NodeexecExecuteNodeRequest,
    agentId: string | undefined,
    verdict: "success" | "failure",
    startedAtMs: number,
    metadata: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (
      request.node_type !== "LLMTask" ||
      agentId === undefined ||
      this.performanceRecorder === undefined
    ) {
      return;
    }
    const usage = metadata?.["usage"];
    const inputTokens =
      isPlainObject(usage) && typeof usage["input_tokens"] === "number"
        ? usage["input_tokens"]
        : undefined;
    const outputTokens =
      isPlainObject(usage) && typeof usage["output_tokens"] === "number"
        ? usage["output_tokens"]
        : undefined;
    const tokenCount =
      inputTokens === undefined && outputTokens === undefined
        ? undefined
        : (inputTokens ?? 0) + (outputTokens ?? 0);
    try {
      await this.performanceRecorder.recordObservation(agentId, {
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_type: request.node_type,
        verdict,
        latency_ms: Date.now() - startedAtMs,
        ...(tokenCount === undefined ? {} : { token_count: tokenCount }),
      });
    } catch (error: unknown) {
      console.error("performance observation recording failed", {
        node_execution_id: request.node_execution_id,
        run_id: request.run_id,
        agent_id: agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #materializeGeneratedFiles(
    request: NodeexecExecuteNodeRequest,
    sessionId: string | undefined,
    output: Record<string, unknown>,
  ): Promise<string> {
    if (this.generatedFileMaterializer === undefined) {
      throw new NodeHandlerValidationError("Generated-file materializer is not configured");
    }
    const projectDirectory = await this.projectProvisioning?.getProjectDirectoryForRun(
      request.tenant_id,
      request.run_id,
    );
    const materialized = await this.generatedFileMaterializer.materialize({
      tenantId: request.tenant_id,
      runId: request.run_id,
      sessionId,
      projectDirectory,
      output,
    });
    return materialized.manifestArtifactId;
  }

  async #appendBestEffort(
    event: Parameters<RunStreamEventService["append"]>[2],
    request: NodeexecExecuteNodeRequest,
  ): Promise<void> {
    try {
      await this.streamEvents?.append(request.tenant_id, request.run_id, event);
    } catch {
      // SSE journal is convenience transport. Durable node_executions remains source of truth.
    }
  }

  async #appendTerminalFramesBestEffort(
    request: NodeexecExecuteNodeRequest,
    output: Record<string, unknown>,
  ): Promise<void> {
    for (const stream of ["stdout", "stderr"] as const) {
      const data = output[stream];
      if (typeof data !== "string" || data.length === 0) continue;
      await this.#appendBestEffort({
        event: "terminal.frame",
        data: { stream, data },
      }, request);
    }
  }

  async #triggerRecoveryBestEffort(
    request: NodeexecExecuteNodeRequest,
    reason: string,
  ): Promise<void> {
    try {
      await this.recovery?.triggerForBlockedNode({
        tenantId: request.tenant_id,
        runId: request.run_id,
        nodeExecutionId: request.node_execution_id,
        reason,
      });
    } catch (error: unknown) {
      // HEAL-6 known gap: no reconciler re-scans blocked nodes lacking a
      // recovery_actions row if this best-effort trigger fails. The block
      // write above already durably succeeded either way.
      console.error("recovery trigger failed for blocked node", {
        node_execution_id: request.node_execution_id,
        run_id: request.run_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Self-Healing exit-check closure: genuine node exceptions (thrown, not
   * Gate-blocked) previously never reached HEAL-5/6 at all, so retry/backoff
   * (and every other strategy) could never actually fire on a real failure
   * class like timeout/infrastructure_failure/rate_limit -- only against
   * Gate-blocked nodes. This is the same best-effort contract as the
   * blocked-node trigger: the failed ledger write above already succeeded
   * durably, so a trigger failure here must not crash the node's response
   * to the Executor.
   */
  async #triggerRecoveryForFailureBestEffort(
    request: NodeexecExecuteNodeRequest,
    failure: { readonly code: string; readonly detail: string },
  ): Promise<void> {
    try {
      await this.recovery?.triggerForFailedNode({
        tenantId: request.tenant_id,
        runId: request.run_id,
        nodeExecutionId: request.node_execution_id,
        errorCode: failure.code,
        detail: failure.detail,
      });
    } catch (error: unknown) {
      console.error("recovery trigger failed for failed node", {
        node_execution_id: request.node_execution_id,
        run_id: request.run_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * HEAL-8: run_outcomes is the VACR/VADR metric source of truth -- a
   * missing verdict is a real gap, not acceptable to silently swallow like
   * the SSE best-effort calls elsewhere in this file. Still caught (not
   * thrown) here so a metrics-write failure never breaks the actual
   * finalizeRun RPC response the Executor workflow is waiting on -- but
   * logged loudly, unlike the SSE convenience-transport catches.
   */
  async #recordOutcomeBestEffort(
    tenantId: string,
    runId: string,
    status: string,
  ): Promise<void> {
    if (status !== "completed" && status !== "failed" && status !== "cancelled") {
      return;
    }
    try {
      await this.runOutcomes?.recordOutcome(tenantId, runId, status);
    } catch (error: unknown) {
      console.error("run_outcomes write failed -- VACR/VADR metrics gap", {
        run_id: runId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #ensureRunStatusBestEffort(
    request: NodeexecExecuteNodeRequest,
  ): Promise<void> {
    try {
      await this.streamEvents?.ensureRunRunning(
        request.tenant_id,
        request.run_id,
      );
    } catch {
      // SSE journal is convenience transport. Durable node_executions remains source of truth.
    }
  }

  /**
   * The Executor workflow's try/finally calls this exactly once, on
   * success or failure -- the only durable write of the run's terminal
   * status (EXEC-14). Idempotent via the ledger's status-guarded UPDATE.
   */
  async finalizeRun(
    request: NodeexecFinalizeRunRequest,
  ): Promise<NodeexecFinalizeRunResponse> {
    if (request.status !== "completed" && request.status !== "failed") {
      throw new NodeHandlerValidationError(
        `finalizeRun status must be "completed" or "failed", got "${request.status}"`,
      );
    }
    const result = await this.ledger.finalizeRun(
      request.tenant_id,
      request.run_id,
      request.status,
    );
    // Project sessions outlive individual node calls, but not the run. This
    // call deliberately remains on the real terminal activity path so an
    // unavailable Provisioning service fails the activity and Temporal
    // retries cleanup instead of silently orphaning the sandbox.
    await this.projectProvisioning?.closeForTerminalRun(
      request.tenant_id,
      request.run_id,
    );
    await this.#recordOutcomeBestEffort(request.tenant_id, request.run_id, result.status);
    // Only emit when the ledger actually applied *this* finalize -- if the
    // run was already terminal for another reason (e.g. cancelled
    // concurrently), result.status reflects that real state instead, and
    // the SSE stream must not misreport it as completed/failed.
    if (result.status === "completed" || result.status === "failed") {
      try {
        await this.streamEvents?.append(request.tenant_id, request.run_id, {
          event: "run.status",
          data: { status: result.status },
        });
      } catch {
        // SSE journal is convenience transport. Durable runs.status remains source of truth.
      }
    }
    return { status: result.status, ended_at: result.endedAt };
  }

  /**
   * Resolves a HumanApproval node_execution left 'running' by executeNode's
   * pending-approval branch, once the Executor workflow's durable wait
   * receives a decision (or expiry). Reuses the same ledger transitions
   * every other node uses -- an approved node "succeeds", a rejected or
   * expired one "fails" -- so downstream consumers (node inspector,
   * run history) see no special-cased state. HEAL-7.
   */
  async finalizeApprovalNode(
    request: NodeexecFinalizeApprovalNodeRequest,
  ): Promise<NodeexecFinalizeApprovalNodeResponse> {
    if (request.decision !== "approved" && request.decision !== "rejected") {
      throw new NodeHandlerValidationError(
        `finalizeApprovalNode decision must be "approved" or "rejected", got "${request.decision}"`,
      );
    }

    if (request.decision === "approved") {
      await this.ledger.recordSucceeded({
        tenantId: request.tenant_id,
        runId: request.run_id,
        nodeExecutionId: request.node_execution_id,
        outputRef: request.node_key,
      });
      await this.#appendApprovalOutcomeBestEffort(request, "succeeded", null);
      return { status: "succeeded" };
    }

    const error = { code: "HUMAN_APPROVAL_REJECTED", detail: "Approval was rejected or expired" };
    await this.ledger.recordFailed(
      {
        tenantId: request.tenant_id,
        runId: request.run_id,
        nodeExecutionId: request.node_execution_id,
      },
      error,
    );
    await this.#appendApprovalOutcomeBestEffort(request, "failed", error);
    return { status: "failed" };
  }

  async #appendApprovalOutcomeBestEffort(
    request: NodeexecFinalizeApprovalNodeRequest,
    status: "succeeded" | "failed",
    error: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      if (status === "succeeded") {
        await this.streamEvents?.append(request.tenant_id, request.run_id, {
          event: "node.completed",
          data: {
            node_execution_id: request.node_execution_id,
            dag_node_key: request.node_key,
            node_type: "HumanApproval",
            attempt: 1,
            status: "succeeded",
            ended_at: new Date().toISOString(),
          },
        });
      } else {
        await this.streamEvents?.append(request.tenant_id, request.run_id, {
          event: "node.failed",
          data: {
            node_execution_id: request.node_execution_id,
            dag_node_key: request.node_key,
            node_type: "HumanApproval",
            attempt: 1,
            status: "failed",
            error: {
              error_code: String(error?.["code"] ?? "HUMAN_APPROVAL_REJECTED"),
              message: String(error?.["detail"] ?? "Approval was rejected or expired"),
              retryable: false,
            },
            ended_at: new Date().toISOString(),
          },
        });
      }
    } catch {
      // SSE journal is convenience transport. Durable node_executions remains source of truth.
    }
  }
}

function safeInputRef(inputsJson: string): string | undefined {
  try {
    const raw = JSON.parse(inputsJson) as unknown;
    if (!isPlainObject(raw)) return undefined;
    const keys = Object.keys(raw);
    return keys.length === 0 ? undefined : keys.join(",");
  } catch {
    // Best-effort only -- the strict inputs_json parse/validation on the
    // dispatch path (parseInputs, below) is what actually fails the node;
    // this must never change that outcome.
    return undefined;
  }
}

function failedEvent(
  request: NodeexecExecuteNodeRequest,
  nodeType: NodeType,
  attempt: number,
  error: { readonly error_code: string; readonly message: string; readonly retryable: boolean },
): Parameters<RunStreamEventService["append"]>[2] {
  return { event: "node.failed", data: {
    node_execution_id: request.node_execution_id,
    dag_node_key: request.node_key,
    node_type: nodeType,
    attempt, status: "failed", error, ended_at: new Date().toISOString(),
  } };
}

function modelAliasFromConfigJson(configJson: string): { readonly modelAlias?: "FAST" | "STANDARD" | "ADVANCED" | "CEILING" } {
  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (!isPlainObject(parsed)) return {};
    const modelAlias = ModelAliasSchema.safeParse(parsed["model_alias"]);
    return modelAlias.success ? { modelAlias: modelAlias.data } : {};
  } catch {
    return {};
  }
}

function persistedError(error: unknown): { readonly code: string; readonly detail: string } {
  if (error instanceof VerifyGateError) {
    return { code: error.code, detail: error.message };
  }
  if (error instanceof NodeHandlerValidationError) {
    return { code: "NODE_HANDLER_VALIDATION_FAILED", detail: error.message };
  }
  return { code: "NODE_EXECUTION_FAILED", detail: "Node execution failed" };
}
