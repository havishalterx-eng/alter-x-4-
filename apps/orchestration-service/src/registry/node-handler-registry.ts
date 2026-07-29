import type { NodeType } from "@alterx/contracts";
import type {
  ModelGatewayHandler,
  SandboxExecuteHandler,
  ToolGatewayInvokeHandler,
} from "@alterx/adapters";
import type { QueueProvider } from "@alterx/shared-clients";

import type { NodeExecutionContext, NodeExecutionResult, NodeHandler } from "./handler";
import { GateHandler } from "./handlers/gate.handler";
import { GroupChatHandler } from "./handlers/groupchat.handler";
import { HumanApprovalHandler, type ApprovalRequester } from "./handlers/human-approval.handler";
import { LlmTaskHandler } from "./handlers/llmtask.handler";
import { MergeHandler } from "./handlers/merge.handler";
import { MemoryWriteHandler } from "./handlers/memory-write.handler";
import { PubSubHandler } from "./handlers/pubsub.handler";
import { SandboxExecHandler } from "./handlers/sandbox-exec.handler";
import { SynthesisHandler } from "./handlers/synthesis.handler";
import { ToolCallHandler } from "./handlers/toolcall.handler";
import { YamlImportHandler } from "./handlers/yaml-import.handler";

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
 * or a disclosed unimplemented type (SandboxExec/Synthesis/MemoryWrite),
 * never a silent no-op. HumanApproval is registered as an explicit
 * non-pending HEAL-7 stub.
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

export interface RuntimeNodeHandlerProviders {
  readonly modelGateway: ModelGatewayHandler;
  readonly toolGateway: ToolGatewayInvokeHandler;
  readonly sandboxService: SandboxExecuteHandler;
  readonly queueProvider: QueueProvider;
  readonly approvalRequester: ApprovalRequester;
}

/** Single runtime composition list; catalog-implemented handlers live here. */
export function createRuntimeNodeHandlerRegistry(
  providers: RuntimeNodeHandlerProviders,
): NodeHandlerRegistry {
  return new NodeHandlerRegistry([
    new GateHandler(),
    new MergeHandler(),
    new PubSubHandler(providers.queueProvider),
    new GroupChatHandler(),
    new YamlImportHandler(),
    new LlmTaskHandler(providers.modelGateway),
    new ToolCallHandler(providers.toolGateway),
    new HumanApprovalHandler(providers.approvalRequester),
    new SandboxExecHandler(providers.sandboxService),
    new SynthesisHandler(),
    new MemoryWriteHandler(),
  ]);
}
