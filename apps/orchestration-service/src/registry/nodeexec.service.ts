import type {
  NodeexecExecuteNodeRequest,
  NodeexecExecuteNodeResponse,
} from "@alterx/contracts";

import { NodeHandlerValidationError } from "./handler";
import type { NodeHandlerRegistry } from "./node-handler-registry";

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
 * gRPC-facing NodeexecHandler: the only server-side entry point that
 * actually dispatches to a Node Type Registry handler. No DB/persistence
 * here yet -- node_executions row persistence is follow-up work (EXEC-6
 * is graph-walking + dispatch, not the full run/node_executions ledger).
 */
export class NodeexecService {
  constructor(private readonly registry: NodeHandlerRegistry) {}

  async executeNode(
    request: NodeexecExecuteNodeRequest,
  ): Promise<NodeexecExecuteNodeResponse> {
    if (request.node_key.trim().length === 0) {
      throw new NodeHandlerValidationError("node_key is required");
    }
    if (request.node_type.trim().length === 0) {
      throw new NodeHandlerValidationError("node_type is required");
    }

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

    return {
      output_json: JSON.stringify(result.output),
      metadata_json: JSON.stringify(result.metadata ?? {}),
    };
  }
}
