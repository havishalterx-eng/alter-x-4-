import { describe, expect, it } from "vitest";

import { CompilerValidationError } from "./dag-builder";
import { compileArchitectureToDag, type ArchitectureCompileInput } from "./architecture-dag-builder";

const input = (): ArchitectureCompileInput => ({
  tenant_id: "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  workspace_id: "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  workflow_id: "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  dag_schema_version: "v1",
  architecture: {
    status: "ready", version: "1", topology: "parallel", boundaries: [{ kind: "human_approval", after_node_key: "review", reason: "customer-visible" }],
    nodes: [
      { source_node_key: "plan", role: "manager", execution_kind: "llm", depends_on: [], capability_role: { source_node_key: "plan", required_capabilities: ["text"], eligible_kinds: ["model"] } },
      { source_node_key: "review", role: "worker", execution_kind: "deterministic", depends_on: ["plan"], capability_role: { source_node_key: "review", required_capabilities: ["search"], eligible_kinds: ["tool"] } },
    ],
    execution_waves: [{ order: 0, node_keys: ["plan"], depends_on_wave_orders: [] }, { order: 1, node_keys: ["review"], depends_on_wave_orders: [0] }],
  },
  binding_decision: { status: "ready", bindings: [
    { record_id: "model-main", version: 3, kind: "model", source_node_key: "plan", rationale: "best", score: 1, factors: { reliability: 1 } },
    { record_id: "tool-review", version: 2, kind: "tool", source_node_key: "review", rationale: "best", score: 1, factors: { reliability: 1 } },
  ] },
});

describe("compileArchitectureToDag", () => {
  it("lowers pinned bindings, topology, and approval boundary deterministically", () => {
    const first = compileArchitectureToDag(input());
    expect(compileArchitectureToDag(input())).toEqual(first);
    expect(first.nodes.find((node) => node.key === "review")?.config).toMatchObject({ capability_record_id: "tool-review", capability_version: 2 });
    expect(first.nodes.find((node) => node.key === "human_approval_review")?.type).toBe("HumanApproval");
    expect(first.waves.map((wave) => wave.node_keys)).toEqual([["plan"], ["review"], ["human_approval_review"]]);
  });

  it.each([
    ["missing binding", (value: ArchitectureCompileInput) => { value.binding_decision.bindings = value.binding_decision.bindings.slice(1); }],
    ["ineligible kind", (value: ArchitectureCompileInput) => { value.binding_decision.bindings[0]!.kind = "tool"; }],
    ["source mismatch", (value: ArchitectureCompileInput) => { value.binding_decision.bindings[0]!.source_node_key = "ghost"; }],
    ["cycle", (value: ArchitectureCompileInput) => { value.architecture.nodes[0]!.depends_on = ["review"]; }],
  ])("rejects %s before lowering", (_name, mutate) => {
    const value = input(); mutate(value);
    expect(() => compileArchitectureToDag(value)).toThrow(CompilerValidationError);
  });
});
