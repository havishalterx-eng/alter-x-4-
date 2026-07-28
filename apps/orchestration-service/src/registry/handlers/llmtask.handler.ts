import { ModelAliasSchema, type NodeType } from "@alterx/contracts";
import type { ModelGatewayHandler } from "@alterx/adapters";
import { ModelGatewayInvalidResponseError } from "@alterx/shared-clients";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * LLMTask: routes through the Model Gateway (the ONLY LLM path -- adapter
 * law) using the node's declared config.model_alias. Never names a
 * concrete model; the Model Gateway resolves the alias via its own
 * versioned policy.
 */
export class LlmTaskHandler implements NodeHandler {
  readonly nodeType: NodeType = "LLMTask";

  constructor(private readonly modelGateway: ModelGatewayHandler) {}

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const modelAlias = context.config["model_alias"];
    const aliasResult = ModelAliasSchema.safeParse(modelAlias);
    if (!aliasResult.success) {
      throw new NodeHandlerValidationError(
        "LLMTask requires config.model_alias to be one of FAST, STANDARD, ADVANCED, CEILING",
      );
    }

    const prompt = context.config["prompt"];
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      throw new NodeHandlerValidationError(
        "LLMTask requires a non-empty config.prompt string",
      );
    }

    if (
      context.tenant_id === undefined ||
      context.run_id === undefined ||
      context.node_execution_id === undefined
    ) {
      throw new NodeHandlerValidationError(
        "LLMTask requires tenant_id, run_id, and node_execution_id on the execution context",
      );
    }

    const response = await this.modelGateway.invoke({
      tenant_id: context.tenant_id,
      run_id: context.run_id,
      node_execution_id: context.node_execution_id,
      model_alias: aliasResult.data,
      input_json: JSON.stringify({ prompt, inputs: context.inputs }),
    });

    // output_json is the actual node result -- fail closed on malformed data,
    // never guess or pass through garbage.
    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(response.output_json);
    } catch (error: unknown) {
      throw new ModelGatewayInvalidResponseError(
        `output_json is not valid JSON: ${(error as Error).message}`,
      );
    }
    if (!isPlainObject(parsedOutput)) {
      throw new ModelGatewayInvalidResponseError("output_json must parse to an object");
    }

    // usage_json is cost/observability metadata, not the task result itself --
    // fail open here (empty usage) rather than losing an otherwise-valid
    // output over a malformed metadata blob.
    let usage: unknown = {};
    try {
      usage = JSON.parse(response.usage_json);
    } catch {
      usage = {};
    }

    return {
      output: parsedOutput,
      metadata: { usage, resolved_capability: response.resolved_capability },
    };
  }
}
