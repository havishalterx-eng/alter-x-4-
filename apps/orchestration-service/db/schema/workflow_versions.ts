import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import type { CompiledDag, WorkflowDagCompiled } from "@alterx/contracts";
import { workflows } from "./workflows";

type CompileMetadata = NonNullable<WorkflowDagCompiled["compile_metadata"]>;

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    version: integer("version").notNull(),
    compiledDag: jsonb("compiled_dag").$type<CompiledDag>().notNull(),
    // The TaskSkeleton this version was compiled from -- what recovery
    // replans against, since the compiled DAG is a different shape and the
    // planner rejects it. Nullable because only a one-way hash of it was kept
    // before 0036, so versions compiled earlier have none and never will.
    //
    // Deliberately untyped: TaskSkeleton is declared in
    // src/compiler/dag-builder.ts rather than in @alterx/contracts, and a
    // schema file reaching into src/ would invert the dependency for
    // decoration alone. Every reader parses it with parseTaskSkeleton, which
    // is where the shape is actually enforced.
    taskSkeleton: jsonb("task_skeleton"),
    dagSchemaVersion: text("dag_schema_version").notNull(),
    // node_requirements and policy_bindings were dropped in 0037: write-only
    // for the life of the table, with no reader anywhere. Requirements are
    // resolved fresh, per node, at run time by NodeExecService and
    // RecoveryDispatchService -- that is and stays the source of truth.
    compileMetadata: jsonb("compile_metadata").$type<CompileMetadata>(),
    status: text("status").notNull().default("compiled"),
    evaluationRunId: text("evaluation_run_id"),
    testedAt: timestamp("tested_at", { withTimezone: true }),
    evaluationFailedAt: timestamp("evaluation_failed_at", { withTimezone: true }),
    trafficPercent: integer("traffic_percent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "workflow_versions_status_check",
      sql`${table.status} IN ('compiled', 'tested', 'canary', 'promoted', 'rolled_back', 'retired')`,
    ),
    check(
      "workflow_versions_tested_evidence_check",
      sql`${table.status} <> 'tested' OR (${table.evaluationRunId} IS NOT NULL AND ${table.testedAt} IS NOT NULL)`,
    ),
    check(
      "workflow_versions_canary_traffic_check",
      sql`(${table.status} = 'canary' AND ${table.trafficPercent} BETWEEN 1 AND 99) OR (${table.status} <> 'canary' AND ${table.trafficPercent} IS NULL)`,
    ),
    unique("workflow_versions_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("workflow_versions_tenant_workflow_version_unique").on(
      table.tenantId,
      table.workflowId,
      table.version,
    ),
    foreignKey({
      name: "workflow_versions_workflow_tenant_fk",
      columns: [table.tenantId, table.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
    index("idx_workflow_versions_workflow").on(table.workflowId),
  ],
);
