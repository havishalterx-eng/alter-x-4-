import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import { runs } from "./runs";

/**
 * The VACR/VADR metric ledger (doc 04 §3) -- every run ends in exactly one
 * explicit verdict row here. Self-Healing phase (HEAL-1): schema only, no
 * writer service yet (that's the run_outcomes ledger ticket later in this
 * phase).
 *
 * `id` is a native uuid, not a prefixed string like every sibling table in
 * this file: doc 04's master ID-prefix list (§1) has no entry for this
 * table, and it is never addressed by its own ID at any API surface --
 * always looked up via run_id (`GET /runs/{id}/outcome`, doc 05). Minting
 * an unlisted prefix here would be inventing a contract shape; disclosed
 * as a deliberate deviation from every other table's text-PK-with-prefix
 * convention.
 */
export const runOutcomes = pgTable(
  "run_outcomes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    mode: text("mode").notNull(),
    eligible: boolean("eligible").notNull(),
    verdict: text("verdict").notNull(),
    humanRescue: boolean("human_rescue").notNull(),
    criticalExternalError: boolean("critical_external_error").notNull(),
    gatesPassed: integer("gates_passed").notNull().default(0),
    gatesFailed: integer("gates_failed").notNull().default(0),
    recoveryCount: integer("recovery_count").notNull().default(0),
    humanRepairAfterComplete: boolean("human_repair_after_complete"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "run_outcomes_mode_check",
      sql`${table.mode} IN ('workflow', 'project')`,
    ),
    check(
      "run_outcomes_verdict_check",
      sql`${table.verdict} IN ('completed_verified', 'rescued', 'escalated', 'failed', 'abandoned', 'degraded')`,
    ),
    unique("run_outcomes_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("run_outcomes_tenant_run_unique").on(table.tenantId, table.runId),
    foreignKey({
      name: "run_outcomes_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete("cascade"),
    index("idx_run_outcomes_tenant_mode_eligible_decided").on(
      table.tenantId,
      table.mode,
      table.eligible,
      table.decidedAt,
    ),
  ],
);
