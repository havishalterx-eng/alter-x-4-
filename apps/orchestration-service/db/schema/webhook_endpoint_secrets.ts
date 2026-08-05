import {
  check,
  foreignKey,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import { webhookEndpoints } from "./webhook_endpoints";

// ENG-BINDING. `secretRef` is a SecretsProvider reference, never a secret
// value -- no signing material is ever stored in this database.
//
// A partial unique index (webhook_endpoint_secrets_single_active, declared in
// migration 0022 because Drizzle's table builder cannot express a WHERE
// clause on a unique constraint) enforces at most one 'active' row per
// endpoint. That is the database-level backstop for the declared hard-cutover
// rotation model: two simultaneously valid secrets cannot exist.
export const webhookEndpointSecrets = pgTable(
  "webhook_endpoint_secrets",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    endpointId: text("endpoint_id").notNull(),
    version: integer("version").notNull(),
    secretRef: text("secret_ref").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "webhook_endpoint_secrets_status_check",
      sql`${table.status} IN ('active', 'revoked')`,
    ),
    check(
      "webhook_endpoint_secrets_revoked_at_check",
      sql`(${table.status} = 'active' AND ${table.revokedAt} IS NULL)
          OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)`,
    ),
    unique("webhook_endpoint_secrets_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    unique("webhook_endpoint_secrets_tenant_endpoint_version_unique").on(
      table.tenantId,
      table.endpointId,
      table.version,
    ),
    foreignKey({
      name: "webhook_endpoint_secrets_endpoint_tenant_fk",
      columns: [table.tenantId, table.endpointId],
      foreignColumns: [webhookEndpoints.tenantId, webhookEndpoints.id],
    }),
  ],
);
