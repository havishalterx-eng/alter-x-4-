import type { NodeType } from "@alterx/contracts";

import type { NodeExecutionContext, NodeExecutionResult, NodeHandler } from "../handler";

/**
 * Merge: combines every upstream node's output into a single object.
 *
 * Deterministic conflict rule: upstream node keys are merged in ascending
 * alphabetical order, so a colliding field name always resolves the same
 * way regardless of arrival order (last key alphabetically wins). This is
 * a simple, predictable default -- richer merge strategies (explicit field
 * mapping, conflict rejection) are a later, more capable revision of this
 * handler, not this ticket's scope.
 */
export class MergeHandler implements NodeHandler {
  readonly nodeType: NodeType = "Merge";

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const upstreamKeys = Object.keys(context.inputs).sort();
    const output: Record<string, unknown> = {};
    for (const key of upstreamKeys) {
      Object.assign(output, context.inputs[key]);
    }
    return { output };
  }
}
