import { z } from "./zod";
import {
  AgentIdSchema,
  ArtifactIdSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  PolicyIdSchema,
  TenantIdSchema,
  WorkflowIdSchema,
  WorkflowVersionIdSchema,
  WorkspaceIdSchema,
} from "./ids";

export const NodeTypeSchema = z.enum([
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

const NodeKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{0,127}$/i, {
    message: "Node keys must be stable graph-local identifiers",
  });
const EdgeKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{0,127}$/i);
const WaveKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{0,127}$/i);

const WorkflowDagNodeSchema = z
  .object({
    key: NodeKeySchema,
    type: NodeTypeSchema,
    config: z.record(z.string(), z.unknown()),
    metadata: z
      .object({
        ui: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .strict();

const EdgeConditionSchema = z
  .object({
    expression: NonEmptyStringSchema,
    language: z.literal("cel"),
  })
  .strict();

const WorkflowDagEdgeSchema = z
  .object({
    key: EdgeKeySchema,
    from: NodeKeySchema,
    to: NodeKeySchema,
    kind: z.enum([
      "sequential",
      "conditional",
      "loop",
      "merge",
      "developer",
    ]),
    condition: EdgeConditionSchema.optional(),
    loop: z
      .object({
        max_iterations: z.number().int().positive(),
        exit_condition: EdgeConditionSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine(({ kind, condition, loop }, context) => {
    if (kind === "conditional" && condition === undefined) {
      context.addIssue({
        code: "custom",
        message: "Conditional edges require a condition",
        path: ["condition"],
      });
    }

    if (kind === "loop" && loop === undefined) {
      context.addIssue({
        code: "custom",
        message: "Loop edges require bounded loop configuration",
        path: ["loop"],
      });
    }
  });

const WorkflowDagWaveSchema = z
  .object({
    key: WaveKeySchema,
    order: z.number().int().nonnegative(),
    node_keys: z.array(NodeKeySchema).min(1),
    depends_on: z.array(WaveKeySchema),
  })
  .strict();

export const CompiledDagSchema = z
  .object({
    schema_version: NonEmptyStringSchema,
    entry_node_keys: z.array(NodeKeySchema).min(1),
    nodes: z.array(WorkflowDagNodeSchema).min(1),
    edges: z.array(WorkflowDagEdgeSchema),
    waves: z.array(WorkflowDagWaveSchema).min(1),
  })
  .strict()
  .superRefine(({ entry_node_keys, nodes, edges, waves }, context) => {
    const nodeKeys = new Set(nodes.map(({ key }) => key));
    const waveKeys = new Set(waves.map(({ key }) => key));

    if (nodeKeys.size !== nodes.length) {
      context.addIssue({
        code: "custom",
        message: "Node keys must be unique",
        path: ["nodes"],
      });
    }

    if (waveKeys.size !== waves.length) {
      context.addIssue({
        code: "custom",
        message: "Wave keys must be unique",
        path: ["waves"],
      });
    }

    for (const [index, key] of entry_node_keys.entries()) {
      if (!nodeKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Entry node must reference an existing node",
          path: ["entry_node_keys", index],
        });
      }
    }

    for (const [index, edge] of edges.entries()) {
      if (!nodeKeys.has(edge.from) || !nodeKeys.has(edge.to)) {
        context.addIssue({
          code: "custom",
          message: "Edge endpoints must reference existing nodes",
          path: ["edges", index],
        });
      }
    }

    const assignedNodes = new Set<string>();
    for (const [waveIndex, wave] of waves.entries()) {
      for (const [nodeIndex, nodeKey] of wave.node_keys.entries()) {
        if (!nodeKeys.has(nodeKey) || assignedNodes.has(nodeKey)) {
          context.addIssue({
            code: "custom",
            message:
              "Every wave node must exist and may appear in exactly one wave",
            path: ["waves", waveIndex, "node_keys", nodeIndex],
          });
        }
        assignedNodes.add(nodeKey);
      }

      for (const [dependencyIndex, dependency] of wave.depends_on.entries()) {
        if (!waveKeys.has(dependency) || dependency === wave.key) {
          context.addIssue({
            code: "custom",
            message: "Wave dependencies must reference a different wave",
            path: ["waves", waveIndex, "depends_on", dependencyIndex],
          });
        }
      }
    }

    if (assignedNodes.size !== nodeKeys.size) {
      context.addIssue({
        code: "custom",
        message: "Every node must belong to exactly one execution wave",
        path: ["waves"],
      });
    }
  });

export const NodeRequirementSchema = z
  .object({
    capabilities: z.array(NonEmptyStringSchema),
    model_alias: z
      .enum(["FAST", "STANDARD", "ADVANCED", "CEILING"])
      .optional(),
    tools: z
      .array(
        z
          .object({
            name: NonEmptyStringSchema,
            version: NonEmptyStringSchema.optional(),
            permissions: z.array(NonEmptyStringSchema),
          })
          .strict(),
      )
      .optional(),
    preferred_agent_id: AgentIdSchema.optional(),
    maximum_input_bytes: z.number().int().positive().optional(),
  })
  .strict();

export const NodeRequirementsSchema = z.record(
  NodeKeySchema,
  NodeRequirementSchema,
);

export const PolicyBindingSchema = z
  .object({
    policy_id: PolicyIdSchema,
    version: NonEmptyStringSchema,
  })
  .strict();

export const PolicyBindingsSchema = z.record(
  NonEmptyStringSchema,
  PolicyBindingSchema,
);

const CompileMetadataSchema = z
  .object({
    compiler_version: NonEmptyStringSchema,
    source_skeleton_hash: NonEmptyStringSchema,
    compiled_at: IsoTimestampSchema,
    source_artifact_id: ArtifactIdSchema.optional(),
  })
  .strict();

export const WorkflowDagDraftSchema = z
  .object({
    status: z.literal("draft"),
    tenant_id: TenantIdSchema,
    workspace_id: WorkspaceIdSchema,
    workflow_id: WorkflowIdSchema,
    revision: z.number().int().nonnegative(),
    dag: CompiledDagSchema,
  })
  .strict();

export const WorkflowVersionStatusSchema = z.enum([
  "compiled",
  "canary",
  "promoted",
  "rolled_back",
  "retired",
]);

export const WorkflowDagCompiledSchema = z
  .object({
    id: WorkflowVersionIdSchema,
    tenant_id: TenantIdSchema,
    workflow_id: WorkflowIdSchema,
    version: z.number().int().positive(),
    compiled_dag: CompiledDagSchema,
    dag_schema_version: NonEmptyStringSchema,
    node_requirements: NodeRequirementsSchema.optional(),
    policy_bindings: PolicyBindingsSchema.optional(),
    compile_metadata: CompileMetadataSchema.optional(),
    status: WorkflowVersionStatusSchema,
  })
  .strict()
  .readonly();

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type CompiledDag = z.infer<typeof CompiledDagSchema>;
export type NodeRequirements = z.infer<typeof NodeRequirementsSchema>;
export type PolicyBindings = z.infer<typeof PolicyBindingsSchema>;
export type WorkflowDagDraft = z.infer<typeof WorkflowDagDraftSchema>;
export type WorkflowDagCompiled = z.infer<
  typeof WorkflowDagCompiledSchema
>;
