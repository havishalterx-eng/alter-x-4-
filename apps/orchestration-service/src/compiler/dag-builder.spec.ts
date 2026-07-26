import { describe, expect, it } from "vitest";

import {
  CompilerValidationError,
  compileTaskSkeletonToDag,
  parseTaskSkeleton,
  type TaskSkeleton,
} from "./dag-builder";

function sequentialSkeleton(): TaskSkeleton {
  return {
    version: "1",
    entry_point: "node_a",
    nodes: [
      { key: "node_a", type: "tool", config: { component: "Provisioning" }, depends_on: [] },
      { key: "node_b", type: "llm", config: {}, depends_on: ["node_a"] },
      { key: "node_c", type: "tool", config: {}, depends_on: ["node_b"] },
    ],
  };
}

function managerWorkerSkeleton(): TaskSkeleton {
  return {
    version: "1",
    entry_point: "node_manager",
    nodes: [
      { key: "node_manager", type: "llm", config: {}, depends_on: [] },
      { key: "node_worker_a", type: "llm", config: {}, depends_on: ["node_manager"] },
      { key: "node_worker_b", type: "llm", config: {}, depends_on: ["node_manager"] },
      {
        key: "node_join",
        type: "join",
        config: {},
        depends_on: ["node_worker_a", "node_worker_b"],
      },
    ],
  };
}

describe("parseTaskSkeleton", () => {
  it("parses a well-formed skeleton", () => {
    const json = JSON.stringify(sequentialSkeleton());

    expect(parseTaskSkeleton(json)).toEqual(sequentialSkeleton());
  });

  it("rejects invalid JSON", () => {
    expect(() => parseTaskSkeleton("{not json")).toThrow(CompilerValidationError);
  });

  it("rejects JSON that does not match the TaskSkeleton shape", () => {
    expect(() => parseTaskSkeleton(JSON.stringify({ foo: "bar" }))).toThrow(
      CompilerValidationError,
    );
  });

  it("rejects an unknown node type", () => {
    const bad = { ...sequentialSkeleton() };
    bad.nodes = [{ ...bad.nodes[0]!, type: "unknown" as never }];
    expect(() => parseTaskSkeleton(JSON.stringify(bad))).toThrow(CompilerValidationError);
  });
});

describe("compileTaskSkeletonToDag", () => {
  it("produces one node per skeleton node with mapped types", () => {
    const dag = compileTaskSkeletonToDag(sequentialSkeleton(), "v1");

    expect(dag.nodes.map((n) => [n.key, n.type])).toEqual([
      ["node_a", "ToolCall"],
      ["node_b", "LLMTask"],
      ["node_c", "ToolCall"],
    ]);
    for (const node of dag.nodes) {
      expect(node.metadata).toEqual({ ui: {} });
    }
  });

  it("carries schema_version through from the caller", () => {
    const dag = compileTaskSkeletonToDag(sequentialSkeleton(), "dag-schema-v3");

    expect(dag.schema_version).toBe("dag-schema-v3");
  });

  it("sets entry_node_keys to the skeleton's entry_point", () => {
    const dag = compileTaskSkeletonToDag(sequentialSkeleton(), "v1");

    expect(dag.entry_node_keys).toEqual(["node_a"]);
  });

  it("synthesizes one sequential edge per depends_on pair", () => {
    const dag = compileTaskSkeletonToDag(sequentialSkeleton(), "v1");

    expect(dag.edges).toEqual([
      { key: "node_a-to-node_b", from: "node_a", to: "node_b", kind: "sequential" },
      { key: "node_b-to-node_c", from: "node_b", to: "node_c", kind: "sequential" },
    ]);
  });

  it("marks edges into a join node as kind=merge", () => {
    const dag = compileTaskSkeletonToDag(managerWorkerSkeleton(), "v1");

    const joinEdges = dag.edges.filter((e) => e.to === "node_join");
    expect(joinEdges).toHaveLength(2);
    for (const edge of joinEdges) {
      expect(edge.kind).toBe("merge");
    }
  });

  it("computes sequential waves for a linear chain", () => {
    const dag = compileTaskSkeletonToDag(sequentialSkeleton(), "v1");

    expect(dag.waves).toEqual([
      { key: "wave_0", order: 0, node_keys: ["node_a"], depends_on: [] },
      { key: "wave_1", order: 1, node_keys: ["node_b"], depends_on: ["wave_0"] },
      { key: "wave_2", order: 2, node_keys: ["node_c"], depends_on: ["wave_1"] },
    ]);
  });

  it("groups parallel workers into the same wave", () => {
    const dag = compileTaskSkeletonToDag(managerWorkerSkeleton(), "v1");

    expect(dag.waves).toEqual([
      { key: "wave_0", order: 0, node_keys: ["node_manager"], depends_on: [] },
      {
        key: "wave_1",
        order: 1,
        node_keys: ["node_worker_a", "node_worker_b"],
        depends_on: ["wave_0"],
      },
      { key: "wave_2", order: 2, node_keys: ["node_join"], depends_on: ["wave_1"] },
    ]);
  });

  it("every node belongs to exactly one wave", () => {
    const dag = compileTaskSkeletonToDag(managerWorkerSkeleton(), "v1");

    const waveNodeKeys = dag.waves.flatMap((w) => w.node_keys);
    expect(waveNodeKeys.sort()).toEqual(dag.nodes.map((n) => n.key).sort());
  });

  it("rejects an entry_point that does not exist", () => {
    const skeleton = { ...sequentialSkeleton(), entry_point: "does_not_exist" };
    expect(() => compileTaskSkeletonToDag(skeleton, "v1")).toThrow(CompilerValidationError);
  });

  it("rejects an entry_point node that has dependencies", () => {
    const skeleton = sequentialSkeleton();
    skeleton.nodes[0] = { ...skeleton.nodes[0]!, depends_on: ["node_c"] };
    expect(() => compileTaskSkeletonToDag(skeleton, "v1")).toThrow(CompilerValidationError);
  });

  it("rejects a duplicate node key", () => {
    const skeleton = sequentialSkeleton();
    skeleton.nodes.push({ key: "node_a", type: "tool", config: {}, depends_on: [] });
    expect(() => compileTaskSkeletonToDag(skeleton, "v1")).toThrow(CompilerValidationError);
  });

  it("rejects a depends_on referencing an unknown node", () => {
    const skeleton = sequentialSkeleton();
    skeleton.nodes[1] = { ...skeleton.nodes[1]!, depends_on: ["node_missing"] };
    expect(() => compileTaskSkeletonToDag(skeleton, "v1")).toThrow(CompilerValidationError);
  });

  it("rejects a dependency cycle", () => {
    const skeleton: TaskSkeleton = {
      version: "1",
      entry_point: "node_a",
      nodes: [
        { key: "node_a", type: "tool", config: {}, depends_on: [] },
        { key: "node_b", type: "tool", config: {}, depends_on: ["node_c"] },
        { key: "node_c", type: "tool", config: {}, depends_on: ["node_b"] },
      ],
    };
    expect(() => compileTaskSkeletonToDag(skeleton, "v1")).toThrow(CompilerValidationError);
  });

  it("produces a single-node DAG for a single-node skeleton", () => {
    const skeleton: TaskSkeleton = {
      version: "1",
      entry_point: "only",
      nodes: [{ key: "only", type: "tool", config: {}, depends_on: [] }],
    };
    const dag = compileTaskSkeletonToDag(skeleton, "v1");

    expect(dag.nodes).toHaveLength(1);
    expect(dag.edges).toEqual([]);
    expect(dag.waves).toEqual([
      { key: "wave_0", order: 0, node_keys: ["only"], depends_on: [] },
    ]);
  });
});
