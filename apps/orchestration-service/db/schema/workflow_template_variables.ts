import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import { workflows } from "./workflows";
import { workflowVersions } from "./workflow_versions";

export const workflowTemplateVariableDefinitions = pgTable(
  "workflow_template_variable_definitions",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowVersionId: text("workflow_version_id").notNull(),
    name: text("name").notNull(),
    valueType: text("value_type").notNull(),
    required: boolean("required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "workflow_template_variable_definitions_type_check",
      sql`${table.valueType} IN ('text', 'number', 'secret', 'list')`,
    ),
    unique("workflow_template_variable_definition_version_name_unique").on(
      table.tenantId,
      table.workflowVersionId,
      table.name,
    ),
    foreignKey({
      name: "workflow_template_variable_definitions_workflow_tenant_fk",
      columns: [table.tenantId, table.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "workflow_template_variable_definitions_version_tenant_fk",
      columns: [table.tenantId, table.workflowVersionId],
      foreignColumns: [workflowVersions.tenantId, workflowVersions.id],
    }).onDelete("cascade"),
    index("idx_workflow_template_variable_definitions_workflow").on(
      table.tenantId,
      table.workflowId,
      table.workflowVersionId,
    ),
  ],
);

export const workflowTemplateVariableValues = pgTable(
  "workflow_template_variable_values",
  {
    tenantId: uuid("tenant_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    name: text("name").notNull(),
    valueJson: jsonb("value_json").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "workflow_template_variable_values_pk",
      columns: [table.tenantId, table.workflowId, table.name],
    }),
    foreignKey({
      name: "workflow_template_variable_values_workflow_tenant_fk",
      columns: [table.tenantId, table.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }).onDelete("cascade"),
  ],
);
