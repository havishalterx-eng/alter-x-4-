import type { NodeType } from "@alterx/contracts";

import type {
  NodeExecutionContext,
  NodeExecutionResult,
  NodeHandler,
} from "../handler";

/**
 * Explicit HEAL-7 boundary. This is neither success nor pending approval;
 * callers can unambiguously stop instead of pretending an approval exists.
 */
export class HumanApprovalHandler implements NodeHandler {
  readonly nodeType: NodeType = "HumanApproval";

  async execute(
    // Kept for NodeHandler parity; HEAL-7 will consume approval config.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    return {
      output: {
        stub: true,
        pending: false,
        code: "approval_not_implemented",
        implementation_ticket: "HEAL-7",
      },
      metadata: { execution_status: "not_implemented" },
    };
  }
}
