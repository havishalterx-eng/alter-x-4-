import type {
  NodeexecExecuteNodeRequest,
  NodeexecExecuteNodeResponse,
  NodeexecFinalizeRunRequest,
  NodeexecFinalizeRunResponse,
} from "@alterx/contracts";
import {
  ModelAliasSchema,
  NodeTypeSchema,
  ProblemDetailsSchema,
  type NodeType,
} from "@alterx/contracts";

import { NodeHandlerValidationError } from "./handler";
import type { NodeHandlerRegistry } from "./node-handler-registry";
import { NodeExecutionLedgerService } from "../runs/node-execution-ledger.service";
import { RunStreamEventService } from "../runs/run-stream-event.service";

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

    try {
      const config = parseJsonObject(request.config_json, "config_json");
      const inputs = parseInputs(request.inputs_json);
      const sandboxSessionId = config["sandbox_session_id"];
      const result = await this.registry.execute(request.node_type, {
        config,
        inputs,
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_execution_id: request.node_execution_id,
        ...(typeof sandboxSessionId === "string"
          ? { sandbox_session_id: sandboxSessionId }
          : {}),
        on_model_delta: async (delta, index, final) =>
          this.#appendBestEffort({
            event: "model.delta",
            data: { node_execution_id: request.node_execution_id, delta, index, final },
          }, request),
      });

      const outputJson = JSON.stringify(result.output);
      const metadataJson = JSON.stringify(result.metadata ?? {});
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
      } else {
        await this.ledger.recordSucceeded({
          tenantId: request.tenant_id,
          runId: request.run_id,
          nodeExecutionId: request.node_execution_id,
          outputRef: request.node_key,
        });
        await this.#appendBestEffort({ event: "node.completed", data: {
          node_execution_id: request.node_execution_id, dag_node_key: request.node_key,
          node_type: nodeType.data, attempt: started.attempt,
          status: "succeeded", ended_at: new Date().toISOString(),
        } }, request);
      }
      return { output_json: outputJson, metadata_json: metadataJson };
    } catch (error: unknown) {
      await this.ledger.recordFailed(
        {
          tenantId: request.tenant_id,
          runId: request.run_id,
          nodeExecutionId: request.node_execution_id,
        },
        persistedError(error),
      );
      await this.#appendBestEffort(failedEvent(request, nodeType.data, started.attempt, {
        error_code: "NODE_EXECUTION_FAILED", message: "Node execution failed", retryable: false,
      }), request);
      throw error;
    }
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

function persistedError(error: unknown): Record<string, unknown> {
  if (error instanceof NodeHandlerValidationError) {
    return { code: "NODE_HANDLER_VALIDATION_FAILED", detail: error.message };
  }
  return { code: "NODE_EXECUTION_FAILED", detail: "Node execution failed" };
}
