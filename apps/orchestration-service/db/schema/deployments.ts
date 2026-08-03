import {
  check,
  foreignKey,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import { projects } from "./projects";

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "deployments_status_check",
      sql`${table.status} IN ('pending', 'active', 'failed')`,
    ),
    unique("deployments_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "deployments_project_tenant_fk",
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    index("idx_deployments_project").on(table.tenantId, table.projectId),
  ],
);
