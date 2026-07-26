// Mirrors apps/orchestration-service/src/trigger-registry/trigger-registry.service.ts's
// real Trigger/TriggerVersion/RegisterTriggerResult shapes exactly -- field
// names, enum values, nullability, and casing. That service is the source
// of truth, this only gives it a typed public contract home.
//
// Field names are intentionally camelCase (tenantId, workflowId,
// triggerVersion, nextFireAt, ...), NOT snake_case like the rest of this
// OpenAPI contract. That's not a typo here -- trigger-registry.controller.ts
// returns these TS objects directly over HTTP with no serialization
// transform (no ClassSerializerInterceptor, no global JSON key-casing
// anywhere in orchestration-service), so the real wire format genuinely is
// camelCase today. This schema documents that reality; it does not invent
// consistency the running code doesn't have. Making Trigger Registry's wire
// format snake_case to match everything else is a real, separate, backward-
// incompatible Engine fix -- out of scope for this contract-only PR.
import { z } from "./zod";
import {
  IsoTimestampSchema,
  NonEmptyStringSchema,
  TenantIdSchema,
  TriggerIdSchema,
  TriggerVersionIdSchema,
  WorkflowIdSchema,
  WorkflowVersionIdSchema,
  WorkspaceIdSchema,
} from "./ids";

export const TriggerTypeSchema = z.enum(["webhook", "cron", "manual"]);
export const TriggerStatusSchema = z.enum([
  "draft",
  "enabled",
  "disabled",
  "archived",
]);
export const TriggerVersionStatusSchema = z.enum([
  "active",
  "superseded",
  "disabled",
]);

export const TriggerSchema = z
  .object({
    id: TriggerIdSchema,
    tenantId: TenantIdSchema,
    workspaceId: WorkspaceIdSchema,
    workflowId: WorkflowIdSchema,
    name: NonEmptyStringSchema,
    type: TriggerTypeSchema,
    status: TriggerStatusSchema,
    provider: NonEmptyStringSchema.nullable(),
  })
  .strict();

export const TriggerVersionSchema = z
  .object({
    id: TriggerVersionIdSchema,
    tenantId: TenantIdSchema,
    triggerId: TriggerIdSchema,
    version: z.number().int().positive(),
    workflowVersionId: WorkflowVersionIdSchema.nullable(),
    config: z.record(z.string(), z.unknown()),
    status: TriggerVersionStatusSchema,
    nextFireAt: IsoTimestampSchema.nullable(),
  })
  .strict();

// registerTrigger()'s real return shape: { trigger, triggerVersion }, both
// camelCase keys, no wrapper/envelope beyond that.
export const RegisterTriggerResultSchema = z
  .object({
    trigger: TriggerSchema,
    triggerVersion: TriggerVersionSchema,
  })
  .strict();

// listTriggers()'s real return shape via the controller: { triggers: [...] },
// not the generic cursor-paginated envelope every other collection route
// uses -- listTriggers() has no pagination at all today.
export const TriggerListResultSchema = z
  .object({
    triggers: z.array(TriggerSchema),
  })
  .strict();

export type Trigger = z.infer<typeof TriggerSchema>;
export type TriggerVersion = z.infer<typeof TriggerVersionSchema>;
