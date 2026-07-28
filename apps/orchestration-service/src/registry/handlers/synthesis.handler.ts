import type { NodeType } from "@alterx/contracts";

import type {
  NodeExecutionContext,
  NodeExecutionResult,
  NodeHandler,
} from "../handler";

/** Explicit Output-phase boundary; never claims synthesized content exists. */
export class SynthesisHandler implements NodeHandler {
  readonly nodeType: NodeType = "Synthesis";

  async execute(
    // Output phase will consume inputs/config.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    return {
      output: {
        stub: true,
        code: "synthesis_not_implemented",
        implementation_phase: "Output",
      },
      metadata: { execution_status: "not_implemented" },
    };
  }
}
