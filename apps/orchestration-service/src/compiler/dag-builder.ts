/**
 * Graph Compiler core: bound Task Skeleton (Planner output, see
 * apps/intelligence-service/src/planner/task_skeleton.py) -> typed
 * CompiledDag (packages/contracts/src/workflow-dag.ts, the locked contract
 * every other Engine component reads).
 *
 * Pure and deterministic: given the same skeleton and schema version, always
 * produces the same DAG. No I/O here -- persistence/versioning lives in
 * graph-compiler.service.ts.
 */

import { z } from "zod";

import { CompiledDagSchema, type CompiledDag, type NodeType } from "@alterx/contracts";

export class CompilerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompilerValidationError";
  }
}

const TaskSkeletonNodeSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/i),
    type: z.enum(["llm", "tool", "branch", "join"]),
    config: z.record(z.string(), z.unknown()),
    depends_on: z.array(z.string()),
  })
  .strict();

const TaskSkeletonSchema = z
  .object({
    version: z.string(),
    nodes: z.array(TaskSkeletonNodeSchema).min(1),
    entry_point: z.string(),
  })
  .strict();

export type TaskSkeleton = z.infer<typeof TaskSkeletonSchema>;
type TaskSkeletonNode = z.infer<typeof TaskSkeletonNodeSchema>;

// Planner emits 4 internal node kinds (see task_skeleton.py); the compiled
// DAG uses the full 11-type Node Type Registry vocabulary (doc 13 sec 2).
// This is the one place that maps between them.
const NODE_TYPE_MAP: Record<TaskSkeletonNode["type"], NodeType> = {
  llm: "LLMTask",
  tool: "ToolCall",
  branch: "Gate",
  join: "Merge",
};

export function parseTaskSkeleton(taskSkeletonJson: string): TaskSkeleton {
  let raw: unknown;
  try {
    raw = JSON.parse(taskSkeletonJson);
  } catch (error: unknown) {
    throw new CompilerValidationError(
      `task_skeleton_json is not valid JSON: ${(error as Error).message}`,
    );
  }

  const result = TaskSkeletonSchema.safeParse(raw);
  if (!result.success) {
    throw new CompilerValidationError(
      `task_skeleton_json does not match the expected TaskSkeleton shape: ${result.error.message}`,
    );
  }
  return result.data;
}

export function compileTaskSkeletonToDag(
  skeleton: TaskSkeleton,
  dagSchemaVersion: string,
): CompiledDag {
  const nodesByKey = new Map<string, TaskSkeletonNode>();
  for (const node of skeleton.nodes) {
    if (nodesByKey.has(node.key)) {
      throw new CompilerValidationError(`Duplicate node key in skeleton: ${node.key}`);
    }
    nodesByKey.set(node.key, node);
  }

  const entryNode = nodesByKey.get(skeleton.entry_point);
  if (entryNode === undefined) {
    throw new CompilerValidationError(
      `entry_point "${skeleton.entry_point}" does not reference a node in the skeleton`,
    );
  }
  if (entryNode.depends_on.length > 0) {
    throw new CompilerValidationError(
      `entry_point node "${skeleton.entry_point}" must not depend on any other node`,
    );
  }

  for (const node of skeleton.nodes) {
    for (const dependency of node.depends_on) {
      if (!nodesByKey.has(dependency)) {
        throw new CompilerValidationError(
          `Node "${node.key}" depends_on unknown node "${dependency}"`,
        );
      }
    }
  }

  const nodes: CompiledDag["nodes"] = skeleton.nodes.map((node) => ({
    key: node.key,
    type: NODE_TYPE_MAP[node.type],
    config: node.config,
    metadata: { ui: {} },
  }));

  const edges: CompiledDag["edges"] = [];
  for (const node of skeleton.nodes) {
    const kind = NODE_TYPE_MAP[node.type] === "Merge" ? "merge" : "sequential";
    for (const dependency of node.depends_on) {
      edges.push({
        key: `${dependency}-to-${node.key}`,
        from: dependency,
        to: node.key,
        kind,
      });
    }
  }

  const waves = computeWaves(skeleton, nodesByKey);

  const dag: CompiledDag = {
    schema_version: dagSchemaVersion,
    entry_node_keys: [skeleton.entry_point],
    nodes,
    edges,
    waves,
  };

  // Belt-and-braces: the DAG we just built must satisfy the same contract
  // every other Engine component reads. A failure here is a compiler bug,
  // not a caller input error -- never persist or return a DAG that doesn't
  // pass its own schema.
  const validated = CompiledDagSchema.safeParse(dag);
  if (!validated.success) {
    throw new Error(
      `Graph Compiler produced a CompiledDag that fails its own schema: ${validated.error.message}`,
    );
  }
  return validated.data;
}

function computeWaves(
  skeleton: TaskSkeleton,
  nodesByKey: Map<string, TaskSkeletonNode>,
): CompiledDag["waves"] {
  const waveIndexByNode = new Map<string, number>();
  const remaining = new Set(nodesByKey.keys());
  let waveIndex = 0;

  while (remaining.size > 0) {
    const ready = [...remaining].filter((key) => {
      const node = nodesByKey.get(key);
      return node !== undefined && node.depends_on.every((dep) => waveIndexByNode.has(dep));
    });

    if (ready.length === 0) {
      throw new CompilerValidationError(
        `Skeleton contains a dependency cycle among: ${[...remaining].sort().join(", ")}`,
      );
    }

    for (const key of ready) {
      waveIndexByNode.set(key, waveIndex);
      remaining.delete(key);
    }
    waveIndex += 1;
  }

  const waveCount = waveIndex;
  const waves: CompiledDag["waves"] = [];
  for (let index = 0; index < waveCount; index += 1) {
    const nodeKeys = [...waveIndexByNode.entries()]
      .filter(([, wave]) => wave === index)
      .map(([key]) => key)
      .sort();

    const dependsOnWaveIndexes = new Set<number>();
    for (const key of nodeKeys) {
      const node = nodesByKey.get(key);
      for (const dependency of node?.depends_on ?? []) {
        const dependencyWave = waveIndexByNode.get(dependency);
        if (dependencyWave !== undefined) {
          dependsOnWaveIndexes.add(dependencyWave);
        }
      }
    }

    waves.push({
      key: `wave_${index}`,
      order: index,
      node_keys: nodeKeys,
      depends_on: [...dependsOnWaveIndexes].sort((a, b) => a - b).map((i) => `wave_${i}`),
    });
  }
  return waves;
}
