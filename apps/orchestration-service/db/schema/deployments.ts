import {
  check,
  foreignKey,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "@alterx/adapters";
import { artifacts } from "./artifacts";
import { projects } from "./projects";

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    artifactId: text("artifact_id"),
    destinationReference: text("destination_reference"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "deployments_status_check",
      sql`${table.status} IN ('pending', 'active', 'failed', 'rolled_back')`,
    ),
    check(
      "deployments_active_artifact_check",
      sql`${table.status} <> 'active' OR (${table.artifactId} IS NOT NULL AND ${table.destinationReference} IS NOT NULL)`,
    ),
    unique("deployments_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "deployments_project_tenant_fk",
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: "deployments_artifact_tenant_fk",
      columns: [table.tenantId, table.artifactId],
      foreignColumns: [artifacts.tenantId, artifacts.id],
    }),
    index("idx_deployments_project").on(table.tenantId, table.projectId),
    uniqueIndex("idx_deployments_tenant_project_active")
      .on(table.tenantId, table.projectId)
      .where(sql`${table.status} = 'active'`),
  ],
);
