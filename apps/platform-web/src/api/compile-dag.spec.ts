import { describe, expect, it } from "vitest"

import { compileDag, WorkflowGraphCycleError } from "./compile-dag"

const nodes = [
  { id: "trigger", type: "YAMLImport", position: { x: 0, y: 0 }, data: { label: "Trigger" } },
  { id: "review", type: "HumanApproval", position: { x: 0, y: 0 }, data: { label: "Review" } },
  { id: "publish", type: "PubSub", position: { x: 0, y: 0 }, data: { label: "Publish" } },
]

describe("compileDag", () => {
  it("compiles a valid DAG into ordered waves", () => {
    const dag = compileDag(nodes, [
      { id: "trigger-review", source: "trigger", target: "review" },
      { id: "review-publish", source: "review", target: "publish" },
    ])

    expect(dag.entry_node_keys).toEqual(["trigger"])
    expect(dag.waves.map((wave) => wave.node_keys)).toEqual([
      ["trigger"],
      ["review"],
      ["publish"],
    ])
  })

  it("rejects a cycle and names only the participating nodes", () => {
    expect(() => compileDag(nodes, [
      { id: "trigger-review", source: "trigger", target: "review" },
      { id: "review-publish", source: "review", target: "publish" },
      { id: "publish-review", source: "publish", target: "review" },
    ])).toThrow("Publish, Review")

    try {
      compileDag(nodes, [
        { id: "trigger-review", source: "trigger", target: "review" },
        { id: "review-publish", source: "review", target: "publish" },
        { id: "publish-review", source: "publish", target: "review" },
      ])
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowGraphCycleError)
      expect((error as WorkflowGraphCycleError).nodeIds).toEqual(["publish", "review"])
    }
  })
})
