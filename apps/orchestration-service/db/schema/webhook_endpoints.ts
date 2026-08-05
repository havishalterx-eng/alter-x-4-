import {
  check,
  index,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";

// ENG-BINDING. One webhook endpoint per (tenant, workspace, integration
// connection). `integrationId` references platform-api's oauth_connections.id
// across a service boundary, so there is deliberately no foreign key here.
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    integrationId: uuid("integration_id").notNull(),
    // 256-bit CSPRNG base64url token forming the unguessable URL path.
    pathToken: text("path_token").notNull(),
    maxSkewSeconds: integer("max_skew_seconds").notNull().default(300),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "webhook_endpoints_max_skew_seconds_check",
      sql`${table.maxSkewSeconds} BETWEEN 30 AND 900`,
    ),
    unique("webhook_endpoints_path_token_unique").on(table.pathToken),
    unique("webhook_endpoints_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("webhook_endpoints_tenant_workspace_integration_unique").on(
      table.tenantId,
      table.workspaceId,
      table.integrationId,
    ),
    index("idx_webhook_endpoints_tenant_workspace").on(
      table.tenantId,
      table.workspaceId,
    ),
  ],
);
