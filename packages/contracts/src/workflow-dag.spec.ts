import { describe, expect, it } from "vitest";
import {
  CompiledDagSchema,
  NodeRequirementsSchema,
  NodeTypeSchema,
  PolicyBindingsSchema,
  WorkflowDagCompiledSchema,
  WorkflowDagDraftSchema,
} from "./workflow-dag";
import { graphFixture, ids, timestamp } from "./test-fixtures";

const nodeTypes = [
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
] as const;

const validDraft = {
  status: "draft",
  tenant_id: ids.tenant,
  workspace_id: ids.workspace,
  workflow_id: ids.workflow,
  revision: 0,
  dag: graphFixture,
};

const validRequirements = {
  start: {
    capabilities: ["text.generation"],
    model_alias: "STANDARD",
    tools: [],
    preferred_agent_id: ids.agent,
    maximum_input_bytes: 16_384,
  },
};

const validPolicies = {
  safety: {
    policy_id: ids.policy,
    version: "2026-07-22",
  },
};

const validCompiled = {
  id: ids.workflowVersion,
  tenant_id: ids.tenant,
  workflow_id: ids.workflow,
  version: 1,
  compiled_dag: graphFixture,
  dag_schema_version: "1.0.0",
  node_requirements: validRequirements,
  policy_bindings: validPolicies,
  compile_metadata: {
    compiler_version: "1.0.0",
    source_skeleton_hash: "sha256:abc123",
    compiled_at: timestamp,
    source_artifact_id: ids.artifact,
  },
  status: "compiled",
};

describe("NodeTypeSchema", () => {
  it("accepts exactly the 11 approved node types", () => {
    expect(NodeTypeSchema.options).toEqual(nodeTypes);
    for (const nodeType of nodeTypes) {
      expect(NodeTypeSchema.safeParse(nodeType).success).toBe(true);
    }
  });

  it("rejects an invented twelfth node type", () => {
    expect(NodeTypeSchema.safeParse("HttpRequest").success).toBe(false);
  });
});

describe("WorkflowDagDraftSchema", () => {
  it("accepts a typed mutable draft with metadata.ui", () => {
    expect(WorkflowDagDraftSchema.safeParse(validDraft).success).toBe(true);
  });

  it("rejects a node missing metadata.ui", () => {
    const invalidDraft = {
      ...validDraft,
      dag: {
        ...graphFixture,
        nodes: graphFixture.nodes.map((node, index) =>
          index === 0
            ? { ...node, metadata: { label: "Missing UI" } }
            : node,
        ),
      },
    };
    expect(WorkflowDagDraftSchema.safeParse(invalidDraft).success).toBe(false);
  });
});

describe("CompiledDagSchema", () => {
  it("accepts the standalone compiled_dag column value", () => {
    expect(CompiledDagSchema.safeParse(validDraft.dag).success).toBe(true);
  });

  it("rejects a graph with a dangling edge endpoint", () => {
    expect(
      CompiledDagSchema.safeParse({
        ...validDraft.dag,
        edges: [
          {
            key: "missing-target",
            from: "start",
            to: "missing",
            kind: "sequential",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("NodeRequirementsSchema", () => {
  it("accepts per-node capability, model, and tool requirements", () => {
    expect(NodeRequirementsSchema.safeParse(validRequirements).success).toBe(
      true,
    );
  });

  it("rejects an unknown model alias", () => {
    expect(
      NodeRequirementsSchema.safeParse({
        start: { capabilities: [], model_alias: "ULTRA" },
      }).success,
    ).toBe(false);
  });
});

describe("PolicyBindingsSchema", () => {
  it("accepts versioned policy bindings", () => {
    expect(PolicyBindingsSchema.safeParse(validPolicies).success).toBe(true);
  });

  it("rejects a non-prefixed policy ID", () => {
    expect(
      PolicyBindingsSchema.safeParse({
        safety: { policy_id: "policy-1", version: "1" },
      }).success,
    ).toBe(false);
  });
});

describe("WorkflowDagCompiledSchema", () => {
  it("accepts a compiled immutable workflow version", () => {
    const parsed = WorkflowDagCompiledSchema.parse(validCompiled);
    expect(parsed.status).toBe("compiled");
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("requires dag_schema_version", () => {
    const withoutVersion = {
      ...validCompiled,
      dag_schema_version: undefined,
    };
    expect(
      WorkflowDagCompiledSchema.safeParse(withoutVersion).success,
    ).toBe(false);
  });

  it("rejects an invalid lifecycle status", () => {
    expect(
      WorkflowDagCompiledSchema.safeParse({
        ...validCompiled,
        status: "active",
      }).success,
    ).toBe(false);
  });

  it("rejects edges that reference missing nodes", () => {
    const invalidCompiled = {
      ...validCompiled,
      compiled_dag: {
        ...graphFixture,
        edges: graphFixture.edges.map((edge, index) =>
          index === 0 ? { ...edge, to: "missing" } : edge,
        ),
      },
    };
    expect(
      WorkflowDagCompiledSchema.safeParse(invalidCompiled).success,
    ).toBe(false);
  });
});
