import type { NodeType } from "@alterx/contracts";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";
import { CelSubsetError, evaluateCelSubset } from "./cel-subset";

/**
 * Gate: evaluates each successor's condition (config.conditions, set by
 * the Graph Compiler's Gate synthesis in dag-builder.ts) against upstream
 * inputs, and reports which successors are active.
 *
 * Uses the CEL subset in cel-subset.ts, not a full CEL implementation --
 * see that module's doc comment for the exact supported grammar.
 */
export class GateHandler implements NodeHandler {
  readonly nodeType: NodeType = "Gate";

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const conditions = context.config["conditions"];
    if (
      conditions === undefined ||
      conditions === null ||
      typeof conditions !== "object" ||
      Array.isArray(conditions)
    ) {
      throw new NodeHandlerValidationError(
        "Gate requires a config.conditions object (successor key -> CEL-subset expression)",
      );
    }

    const evaluations: Record<string, boolean> = {};
    const root = { inputs: context.inputs };
    for (const [successorKey, expression] of Object.entries(
      conditions as Record<string, unknown>,
    )) {
      if (typeof expression !== "string" || expression.trim().length === 0) {
        throw new NodeHandlerValidationError(
          `Gate condition for successor "${successorKey}" must be a non-empty string`,
        );
      }
      try {
        evaluations[successorKey] = evaluateCelSubset(expression, root);
      } catch (error: unknown) {
        if (error instanceof CelSubsetError) {
          throw new NodeHandlerValidationError(
            `Gate condition for successor "${successorKey}" is invalid: ${error.message}`,
          );
        }
        throw error;
      }
    }

    const activeSuccessors = Object.entries(evaluations)
      .filter(([, active]) => active)
      .map(([successorKey]) => successorKey);

    return { output: { activeSuccessors, evaluations } };
  }
}
