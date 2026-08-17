import { z } from "zod";

import { CompiledDagSchema, type CompiledDag, type NodeType } from "@alterx/contracts";

import { CompilerValidationError } from "./dag-builder";

const NodeKey = z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/i);
const CapabilityKind = z.enum(["agent", "model", "tool", "connector", "execution"]);
const ArchitectureNode = z.object({
  source_node_key: NodeKey,
  role: z.enum(["direct", "manager", "worker", "deterministic", "control"]),
  execution_kind: z.enum(["llm", "deterministic", "control"]),
  depends_on: z.array(NodeKey),
  capability_role: z.object({
    source_node_key: NodeKey,
    required_capabilities: z.array(z.string().min(1)),
    eligible_kinds: z.array(CapabilityKind).min(1),
  }).strict().nullable().optional(),
}).strict();
const ArchitectureSpec = z.object({
  status: z.literal("ready"),
  version: z.literal("1"),
  topology: z.enum(["single", "deterministic", "sequential", "parallel", "manager_worker"]),
  nodes: z.array(ArchitectureNode).min(1),
  execution_waves: z.array(z.object({
    order: z.number().int().nonnegative(), node_keys: z.array(NodeKey).min(1), depends_on_wave_orders: z.array(z.number().int().nonnegative()),
  }).strict()).min(1),
  boundaries: z.array(z.object({ kind: z.enum(["verification", "human_approval"]), after_node_key: NodeKey, reason: z.string().min(1) }).strict()),
}).passthrough();
const BindingDecision = z.object({
  status: z.literal("ready"),
  bindings: z.array(z.object({
    record_id: z.string().min(1), version: z.number().int().positive(), kind: CapabilityKind,
    source_node_key: NodeKey, rationale: z.string().min(1), score: z.number().min(0).max(1), factors: z.record(z.string(), z.number()),
  }).strict()),
}).strict();

export const ArchitectureCompileInputSchema = z.object({
  tenant_id: z.string().regex(/^ten_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  workspace_id: z.string().regex(/^ws_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  workflow_id: z.string().regex(/^wf_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  dag_schema_version: z.string().min(1),
  architecture: ArchitectureSpec,
  binding_decision: BindingDecision,
}).strict();
export type ArchitectureCompileInput = z.infer<typeof ArchitectureCompileInputSchema>;

function nodeType(node: z.infer<typeof ArchitectureNode>, binding: z.infer<typeof BindingDecision>["bindings"][number] | undefined): NodeType {
  if (node.execution_kind === "control") return "Gate";
  if (binding?.kind === "execution") return "SandboxExec";
  if (binding?.kind === "tool" || binding?.kind === "connector") return "ToolCall";
  return "LLMTask";
}

/** Pure lowering only. Legacy task-skeleton compilation remains separate until callers migrate. */
export function compileArchitectureToDag(raw: ArchitectureCompileInput): CompiledDag {
  const input = ArchitectureCompileInputSchema.safeParse(raw);
  if (!input.success) throw new CompilerValidationError(`invalid architecture compiler input: ${input.error.message}`);
  const { architecture, binding_decision: decision } = input.data;
  const byKey = new Map<string, z.infer<typeof ArchitectureNode>>();
  for (const node of architecture.nodes) {
    if (byKey.has(node.source_node_key)) throw new CompilerValidationError(`duplicate source node: ${node.source_node_key}`);
    byKey.set(node.source_node_key, node);
    const capabilityRole = node.capability_role;
    if (capabilityRole !== undefined && capabilityRole !== null && capabilityRole.source_node_key !== node.source_node_key) throw new CompilerValidationError(`capability role source-node mismatch: ${node.source_node_key}`);
  }
  const bindings = new Map<string, z.infer<typeof BindingDecision>["bindings"][number]>();
  for (const binding of decision.bindings) {
    if (bindings.has(binding.source_node_key)) throw new CompilerValidationError(`duplicate binding source node: ${binding.source_node_key}`);
    const node = byKey.get(binding.source_node_key);
    if (node === undefined || node.capability_role === null || node.capability_role === undefined) throw new CompilerValidationError(`binding/source-node mismatch: ${binding.source_node_key}`);
    if (!node.capability_role.eligible_kinds.includes(binding.kind)) throw new CompilerValidationError(`ineligible binding kind for ${binding.source_node_key}`);
    bindings.set(binding.source_node_key, binding);
  }
  for (const node of architecture.nodes) {
    if (node.depends_on.some((key) => !byKey.has(key))) throw new CompilerValidationError(`source-node dependency is unknown: ${node.source_node_key}`);
    if (node.capability_role !== null && node.capability_role !== undefined && !bindings.has(node.source_node_key)) throw new CompilerValidationError(`missing binding for required capability role: ${node.source_node_key}`);
  }
  const remaining = new Set(byKey.keys());
  const resolved = new Set<string>();
  while (remaining.size > 0) {
    const ready = [...remaining].filter((key) => (byKey.get(key)?.depends_on ?? []).every((dependency) => resolved.has(dependency)));
    if (ready.length === 0) throw new CompilerValidationError(`architecture contains cyclic dependencies: ${[...remaining].sort().join(", ")}`);
    ready.forEach((key) => { remaining.delete(key); resolved.add(key); });
  }
  const nodes: CompiledDag["nodes"] = architecture.nodes.map((node) => {
    const binding = bindings.get(node.source_node_key);
    return { key: node.source_node_key, type: nodeType(node, binding), config: binding === undefined ? {} : { capability_record_id: binding.record_id, capability_version: binding.version }, metadata: { ui: {} } };
  });
  const edges: CompiledDag["edges"] = architecture.nodes.flatMap((node) => node.depends_on.map((from) => ({ key: `${from}-to-${node.source_node_key}`, from, to: node.source_node_key, kind: "sequential" as const })));
  for (const boundary of architecture.boundaries) {
    if (!byKey.has(boundary.after_node_key)) throw new CompilerValidationError(`boundary references unknown source node: ${boundary.after_node_key}`);
    const key = `${boundary.kind}_${boundary.after_node_key}`;
    if (byKey.has(key)) throw new CompilerValidationError(`boundary node collides with source node: ${key}`);
    nodes.push({ key, type: boundary.kind === "human_approval" ? "HumanApproval" : "Gate", config: { boundary: boundary.kind, reason: boundary.reason }, metadata: { ui: {} } });
    edges.push({ key: `${boundary.after_node_key}-to-${key}`, from: boundary.after_node_key, to: key, kind: "sequential" });
  }
  const waves = architecture.execution_waves.slice().sort((a, b) => a.order - b.order).map((wave) => ({ key: `wave_${wave.order}`, order: wave.order, node_keys: [...wave.node_keys].sort(), depends_on: [...wave.depends_on_wave_orders].sort((a, b) => a - b).map((order) => `wave_${order}`) }));
  const boundaryWaves: CompiledDag["waves"] = [];
  for (const [index, boundary] of architecture.boundaries.entries()) {
    const sourceWave = waves.find((wave) => wave.node_keys.includes(boundary.after_node_key));
    if (sourceWave === undefined) throw new CompilerValidationError(`source node missing from architecture waves: ${boundary.after_node_key}`);
    boundaryWaves.push({ key: `boundary_wave_${index}`, order: (waves.at(-1)?.order ?? 0) + index + 1, node_keys: [`${boundary.kind}_${boundary.after_node_key}`], depends_on: [sourceWave.key] });
  }
  const entry = architecture.nodes.filter((node) => node.depends_on.length === 0).map((node) => node.source_node_key).sort();
  const result = CompiledDagSchema.safeParse({ schema_version: input.data.dag_schema_version, entry_node_keys: entry, nodes, edges, waves: [...waves, ...boundaryWaves] });
  if (!result.success) throw new CompilerValidationError(`invalid architecture DAG: ${result.error.message}`);
  return result.data;
}
