import type { NodeType } from "@alterx/contracts";

import type {
  NodeExecutionContext,
  NodeExecutionResult,
  NodeHandler,
} from "../handler";

/** Explicit Knowledge-phase boundary; never claims memory persisted. */
export class MemoryWriteHandler implements NodeHandler {
  readonly nodeType: NodeType = "MemoryWrite";

  async execute(
    // Knowledge phase will consume inputs/config.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    return {
      output: {
        stub: true,
        code: "memory_write_not_implemented",
        implementation_phase: "Knowledge",
      },
      metadata: { execution_status: "not_implemented" },
    };
  }
}
