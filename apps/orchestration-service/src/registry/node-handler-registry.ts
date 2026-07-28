import type { NodeType } from "@alterx/contracts";

import type { NodeExecutionContext, NodeExecutionResult, NodeHandler } from "./handler";

export class NodeTypeNotImplementedError extends Error {
  constructor(nodeType: string) {
    super(`No handler is implemented for node type "${nodeType}"`);
    this.name = "NodeTypeNotImplementedError";
  }
}

export class UnknownNodeTypeError extends Error {
  constructor(nodeType: string) {
    super(`"${nodeType}" is not a recognised Node Type Registry type`);
    this.name = "UnknownNodeTypeError";
  }
}

const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set<NodeType>([
  "LLMTask",
  "ToolCall",
  "SandboxExec",
  "Gate",
  "HumanApproval",
  "Merge",
  "Synthesis",
  "MemoryWrite",
  "PubSub",
  "GroupChat",
  "YAMLImport",
]);

/**
 * Dispatches a node execution to its registered handler. Mirrors
 * node-type-catalog.ts's handler_implemented flags exactly -- a type
 * missing from this registry's map is either unknown (not one of the 11)
 * or a disclosed stub (ToolCall/SandboxExec/HumanApproval/Synthesis/
 * MemoryWrite), never a silent no-op.
 */
export class NodeHandlerRegistry {
  readonly #handlers: ReadonlyMap<NodeType, NodeHandler>;

  constructor(handlers: readonly NodeHandler[]) {
    const map = new Map<NodeType, NodeHandler>();
    for (const handler of handlers) {
      map.set(handler.nodeType, handler);
    }
    this.#handlers = map;
  }

  async execute(
    nodeType: string,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    if (!KNOWN_NODE_TYPES.has(nodeType)) {
      throw new UnknownNodeTypeError(nodeType);
    }
    const handler = this.#handlers.get(nodeType as NodeType);
    if (handler === undefined) {
      throw new NodeTypeNotImplementedError(nodeType);
    }
    return handler.execute(context);
  }
}
