import {
  bigint,
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
import { runs } from "./runs";

/** Durable, tenant-owned build and execution artifacts (0020_create_artifacts.sql). */
export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    storageReference: text("storage_reference").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("artifacts_size_bytes_nonnegative", sql`${table.sizeBytes} >= 0`),
    unique("artifacts_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "artifacts_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete("cascade"),
    index("idx_artifacts_tenant_run_created").on(
      table.tenantId,
      table.runId,
      table.createdAt,
    ),
  ],
);
