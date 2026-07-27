import {
  TriggerStatusSchema,
  TriggerTypeSchema,
} from "@alterx/contracts/src/triggers";
import { z } from "zod";
import { TriggerHttpError } from "./problem";
import type {
  CreateTriggerInput,
  CreateTriggerVersionInput,
  SetTriggerStatusInput,
} from "./types";

const triggerIdPattern =
  /^trg_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workflowIdPattern =
  /^wf_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workflowVersionIdPattern =
  /^wfv_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workspaceIdPattern =
  /^ws_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jsonObject = z.record(z.string(), z.json());

const createTriggerSchema = z
  .object({
    workspaceId: z.string().regex(workspaceIdPattern),
    workflowId: z.string().regex(workflowIdPattern),
    name: z.string().trim().min(1).max(200),
    type: TriggerTypeSchema,
    provider: z.string().trim().min(1).max(100).optional(),
    workflowVersionId: z.string().regex(workflowVersionIdPattern).optional(),
    config: jsonObject.optional(),
  })
  .strict();

const createVersionSchema = z
  .object({
    workflowVersionId: z.string().regex(workflowVersionIdPattern).optional(),
    config: jsonObject.optional(),
  })
  .strict();

const setStatusSchema = z
  .object({ status: TriggerStatusSchema })
  .strict();

export function parseCreateTrigger(
  input: unknown,
  instance: string,
): CreateTriggerInput {
  const parsed = parse(createTriggerSchema, input, instance);
  return {
    workspaceId: parsed.workspaceId,
    workflowId: parsed.workflowId,
    name: parsed.name,
    type: parsed.type,
    ...(parsed.provider === undefined ? {} : { provider: parsed.provider }),
    ...(parsed.workflowVersionId === undefined
      ? {}
      : { workflowVersionId: parsed.workflowVersionId }),
    ...(parsed.config === undefined ? {} : { config: parsed.config }),
  };
}

export function parseCreateTriggerVersion(
  input: unknown,
  instance: string,
): CreateTriggerVersionInput {
  const parsed = parse(createVersionSchema, input, instance);
  return {
    ...(parsed.workflowVersionId === undefined
      ? {}
      : { workflowVersionId: parsed.workflowVersionId }),
    ...(parsed.config === undefined ? {} : { config: parsed.config }),
  };
}

export function parseSetTriggerStatus(
  input: unknown,
  instance: string,
): SetTriggerStatusInput {
  return parse(setStatusSchema, input, instance);
}

export function parseTriggerId(value: string, instance: string): string {
  if (!triggerIdPattern.test(value)) {
    throw invalid(instance, [{ field: "id", message: "Invalid trigger id" }]);
  }
  return value;
}

export function parseWorkflowIdQuery(
  value: string | undefined,
  instance: string,
): string | undefined {
  if (value !== undefined && !workflowIdPattern.test(value)) {
    throw invalid(instance, [
      { field: "workflowId", message: "Invalid workflow id" },
    ]);
  }
  return value;
}

export function parseTraceparent(
  value: string | undefined,
  instance: string,
): string | undefined {
  if (
    value !== undefined &&
    !/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(value)
  ) {
    throw invalid(instance, [
      { field: "traceparent", message: "Invalid W3C traceparent" },
    ]);
  }
  return value;
}

function parse<T>(schema: z.ZodType<T>, input: unknown, instance: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw invalid(
    instance,
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

function invalid(
  instance: string,
  fields: NonNullable<ConstructorParameters<typeof TriggerHttpError>[4]>,
): TriggerHttpError {
  return new TriggerHttpError(
    400,
    "INVALID_TRIGGER_REQUEST",
    "Trigger request validation failed",
    instance,
    fields,
  );
}
