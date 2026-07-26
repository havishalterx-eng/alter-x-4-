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
import type {
  CompiledDag,
  NodeRequirements,
  PolicyBindings,
  WorkflowDagCompiled,
} from "@alterx/contracts";
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
    dagSchemaVersion: text("dag_schema_version").notNull(),
    nodeRequirements: jsonb("node_requirements").$type<NodeRequirements>(),
    policyBindings: jsonb("policy_bindings").$type<PolicyBindings>(),
    compileMetadata: jsonb("compile_metadata").$type<CompileMetadata>(),
    status: text("status").notNull().default("compiled"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "workflow_versions_status_check",
      sql`${table.status} IN ('compiled', 'canary', 'promoted', 'rolled_back', 'retired')`,
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
