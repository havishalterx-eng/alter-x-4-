import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import { runs } from "./runs";

export const runDispatchQueue = pgTable(
  "run_dispatch_queue",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    priority: integer("priority").notNull().default(0),
    compiledDag: jsonb("compiled_dag").notNull(),
    alreadyRunning: boolean("already_running").notNull().default(false),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("run_dispatch_queue_tenant_run_unique").on(table.tenantId, table.runId),
    foreignKey({
      name: "run_dispatch_queue_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }),
    index("idx_run_dispatch_queue_claim").on(
      table.tenantId,
      table.priority,
      table.availableAt,
    ),
  ],
);
