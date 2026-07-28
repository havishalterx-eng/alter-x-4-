import type {
  NodeexecExecuteNodeRequest,
  NodeexecExecuteNodeResponse,
} from "@alterx/contracts";
import { ModelAliasSchema, ProblemDetailsSchema } from "@alterx/contracts";

import { NodeHandlerValidationError } from "./handler";
import type { NodeHandlerRegistry } from "./node-handler-registry";
import { NodeExecutionLedgerService } from "../runs/node-execution-ledger.service";

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

    await this.ledger.recordStarted({
      tenantId: request.tenant_id,
      runId: request.run_id,
      nodeExecutionId: request.node_execution_id,
      dagNodeId: request.node_key,
      nodeType: request.node_type,
      ...modelAliasFromConfigJson(request.config_json),
    });

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
      } else {
        await this.ledger.recordSucceeded({
          tenantId: request.tenant_id,
          runId: request.run_id,
          nodeExecutionId: request.node_execution_id,
        });
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
      throw error;
    }
  }
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
