import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import type { TriggerBindingConfig } from "@alterx/contracts";
import { triggers } from "./triggers";
import { webhookEndpoints } from "./webhook_endpoints";

// ENG-BINDING. Binds one trigger to one integration connection, scoped to the
// workspace that owns the trigger. The (tenant, trigger, integration) unique
// constraint makes a rebind an update rather than a silent duplicate.
export const triggerIntegrationBindings = pgTable(
  "trigger_integration_bindings",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    triggerId: text("trigger_id").notNull(),
    integrationId: uuid("integration_id").notNull(),
    webhookEndpointId: text("webhook_endpoint_id").notNull(),
    config: jsonb("config").$type<TriggerBindingConfig>().notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "trigger_integration_bindings_status_check",
      sql`${table.status} IN ('active', 'disabled')`,
    ),
    unique("trigger_integration_bindings_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    unique("trigger_integration_bindings_tenant_trigger_integration_unique").on(
      table.tenantId,
      table.triggerId,
      table.integrationId,
    ),
    foreignKey({
      name: "trigger_integration_bindings_trigger_tenant_fk",
      columns: [table.tenantId, table.triggerId],
      foreignColumns: [triggers.tenantId, triggers.id],
    }),
    foreignKey({
      name: "trigger_integration_bindings_endpoint_tenant_fk",
      columns: [table.tenantId, table.webhookEndpointId],
      foreignColumns: [webhookEndpoints.tenantId, webhookEndpoints.id],
    }),
    index("idx_trigger_integration_bindings_trigger").on(
      table.tenantId,
      table.triggerId,
    ),
    index("idx_trigger_integration_bindings_endpoint").on(
      table.tenantId,
      table.webhookEndpointId,
      table.status,
    ),
  ],
);
