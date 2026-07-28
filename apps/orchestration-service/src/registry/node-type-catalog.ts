import type { NodeType, RegistryNodeTypeDescriptor } from "@alterx/contracts";

/**
 * The full 11-type Node Type Registry catalog (doc 13 sec 2). This is a
 * global, tenant-free static catalog -- not database-backed, since every
 * tenant sees the same palette.
 *
 * handler_implemented is false for types whose real logic depends on
 * infrastructure not wired in yet:
 * - ToolCall/SandboxExec: need Tool Gateway/Sandbox Service wiring
 *   (later Execution-phase tickets).
 * - HumanApproval: the full approval flow is built in the Self-Healing
 *   phase (see 11-engine-backend-phases.md).
 * - Synthesis: stub until the Output phase (doc explicitly says so).
 * - MemoryWrite: stub until the Knowledge phase (doc explicitly says so).
 * Gate, Merge, PubSub, GroupChat, YAMLImport (EXEC-1) and LLMTask
 * (EXEC-2) have real, tested handlers in ./handlers.
 */

interface CatalogEntry {
  readonly type: NodeType;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly configSchema: Record<string, unknown>;
  readonly handlerImplemented: boolean;
}

const CATALOG_ENTRIES: readonly CatalogEntry[] = [
  {
    type: "LLMTask",
    displayName: "LLM Task",
    description: "Invokes a model (via the Model Gateway) to generate or transform content.",
    category: "execution",
    configSchema: {
      type: "object",
      properties: {
        model_alias: { type: "string", enum: ["FAST", "STANDARD", "ADVANCED", "CEILING"] },
        prompt: { type: "string" },
      },
      required: ["model_alias", "prompt"],
    },
    handlerImplemented: true,
  },
  {
    type: "ToolCall",
    displayName: "Tool Call",
    description: "Invokes a tool (via the Tool Gateway) with a fixed or model-derived input.",
    category: "execution",
    configSchema: {
      type: "object",
      properties: { tool_name: { type: "string" }, arguments: { type: "object" } },
    },
    handlerImplemented: false,
  },
  {
    type: "SandboxExec",
    displayName: "Sandbox Execution",
    description: "Runs code or a build/test step inside an isolated Sandbox Service session.",
    category: "execution",
    configSchema: {
      type: "object",
      properties: { command: { type: "string" } },
    },
    handlerImplemented: false,
  },
  {
    type: "Gate",
    displayName: "Gate",
    description:
      "Evaluates a condition per outgoing edge and reports which successors are active.",
    category: "control-flow",
    configSchema: {
      type: "object",
      properties: {
        conditions: {
          type: "object",
          description: "Map of successor node key -> CEL-subset boolean expression",
          additionalProperties: { type: "string" },
        },
      },
      required: ["conditions"],
    },
    handlerImplemented: true,
  },
  {
    type: "HumanApproval",
    displayName: "Human Approval",
    description: "Pauses the run until a human approver approves or rejects.",
    category: "human-in-the-loop",
    configSchema: {
      type: "object",
      properties: { approver_role: { type: "string" } },
    },
    handlerImplemented: false,
  },
  {
    type: "Merge",
    displayName: "Merge",
    description: "Combines every upstream node's output into a single merged object.",
    category: "control-flow",
    configSchema: { type: "object", properties: {} },
    handlerImplemented: true,
  },
  {
    type: "Synthesis",
    displayName: "Synthesis",
    description: "Synthesizes a final answer from multiple upstream results.",
    category: "output",
    configSchema: { type: "object", properties: {} },
    handlerImplemented: false,
  },
  {
    type: "MemoryWrite",
    displayName: "Memory Write",
    description: "Writes a verified, scoped learning back to ADS memory or the Policy Store.",
    category: "knowledge",
    configSchema: { type: "object", properties: {} },
    handlerImplemented: false,
  },
  {
    type: "PubSub",
    displayName: "Pub/Sub",
    description: "Publishes a payload to a topic via the Queue provider.",
    category: "collaboration",
    configSchema: {
      type: "object",
      properties: { topic: { type: "string" }, payload: { type: "object" } },
      required: ["topic"],
    },
    handlerImplemented: true,
  },
  {
    type: "GroupChat",
    displayName: "Group Chat",
    description: "Assembles a turn sequence across a declared list of participants.",
    category: "collaboration",
    configSchema: {
      type: "object",
      properties: { participants: { type: "array", items: { type: "string" } } },
      required: ["participants"],
    },
    handlerImplemented: true,
  },
  {
    type: "YAMLImport",
    displayName: "YAML Import",
    description: "Parses an inline YAML document into structured node output.",
    category: "import",
    configSchema: {
      type: "object",
      properties: { yaml: { type: "string" } },
      required: ["yaml"],
    },
    handlerImplemented: true,
  },
];

export function listNodeTypeDescriptors(): RegistryNodeTypeDescriptor[] {
  return CATALOG_ENTRIES.map(toDescriptor);
}

export function findNodeTypeDescriptor(
  type: string,
): RegistryNodeTypeDescriptor | undefined {
  const entry = CATALOG_ENTRIES.find((candidate) => candidate.type === type);
  return entry === undefined ? undefined : toDescriptor(entry);
}

function toDescriptor(entry: CatalogEntry): RegistryNodeTypeDescriptor {
  return {
    type: entry.type,
    display_name: entry.displayName,
    description: entry.description,
    category: entry.category,
    config_schema_json: JSON.stringify(entry.configSchema),
    handler_implemented: entry.handlerImplemented,
  };
}
