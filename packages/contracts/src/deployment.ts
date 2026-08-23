// Mirrors apps/orchestration-service/db/schema/workflow_versions.ts's real
// status CHECK constraint and the Workflow Lifecycle's (PLAN-11) real
// promote/canary/rollback results -- typed public contract for a backend
// that already exists and is tested, but had zero route wired to it.
import { z } from "./zod";
import { IsoTimestampSchema, WorkflowVersionIdSchema } from "./ids";

export const WorkflowVersionStatusSchema = z.enum([
  "compiled",
  "tested",
  "canary",
  "promoted",
  "rolled_back",
  "retired",
]);

export const TestVersionResultSchema = z
  .object({ status: z.literal("tested") })
  .strict();

export const TestVersionRequestSchema = z
  .object({ workflowVersionId: WorkflowVersionIdSchema })
  .strict();

// Each operation's status is narrowed to the single literal the real
// service always returns for it (workflow-lifecycle.service.ts), not
// the full WorkflowVersionStatusSchema enum -- more honest than claiming
// promote could return anything other than "promoted".
export const PromoteVersionResultSchema = z
  .object({
    status: z.literal("promoted"),
    promoted_at: IsoTimestampSchema,
  })
  .strict();

export const StartCanaryResultSchema = z
  .object({
    status: z.literal("canary"),
    // Matches requireTrafficPercent's real bounds (1-99), not 0-100.
    traffic_percent: z.number().int().min(1).max(99),
  })
  .strict();

export const RollbackVersionResultSchema = z
  .object({
    status: z.literal("rolled_back"),
    active_version_id: WorkflowVersionIdSchema,
  })
  .strict();
