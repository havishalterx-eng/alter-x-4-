import type { NodeType } from "@alterx/contracts";

/**
 * Shared contract every Node Type Registry handler implements. The
 * (future, not-yet-built) Executor calls execute() once per node visited
 * during a run wave; this ticket only builds the handlers themselves,
 * standalone and unit-tested -- wiring them into a live run is Executor's
 * job in a later Execution-phase ticket.
 */

export class NodeHandlerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeHandlerValidationError";
  }
}

export interface NodeExecutionContext {
  /** This node's compiled config (CompiledDag node.config). */
  readonly config: Record<string, unknown>;
  /** Upstream node outputs, keyed by the producing node's key. */
  readonly inputs: Record<string, Record<string, unknown>>;
}

export interface NodeExecutionResult {
  readonly output: Record<string, unknown>;
}

export interface NodeHandler {
  readonly nodeType: NodeType;
  execute(context: NodeExecutionContext): Promise<NodeExecutionResult>;
}
