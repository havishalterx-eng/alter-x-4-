import {
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

/** Durable replay journal for the best-effort SSE transport. */
export const runStreamEvents = pgTable(
  "run_stream_events",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("run_stream_events_tenant_run_seq_unique").on(
      table.tenantId,
      table.runId,
      table.seq,
    ),
    foreignKey({
      name: "run_stream_events_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete("cascade"),
    index("idx_run_stream_events_tenant_run_seq").on(
      table.tenantId,
      table.runId,
      table.seq,
    ),
  ],
);
