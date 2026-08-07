import { z } from "zod";
import { ActionCentreHttpError } from "./problem";
import type { ActionQueueQuery } from "./types";

const prefixedUuidV7 =
  /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clarificationIdPattern =
  /^clr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const traceparentPattern =
  /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

const queueQuerySchema = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    type: z.enum(["approval", "clarification", "escalation"]).optional(),
    status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      (query.type === "escalation" || query.type === "clarification") &&
      query.status !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Selected action source declares no status filter",
      });
    }
  });

export function parseQueueQuery(
  input: unknown,
  instance: string,
): ActionQueueQuery {
  return parse(queueQuerySchema, input, instance);
}

export function parseActionBody(
  input: unknown,
  instance: string,
): Readonly<Record<string, unknown>> {
  const value = input === undefined ? {} : input;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError(instance, [
      { field: "body", message: "Expected an object" },
    ]);
  }
  return value as Readonly<Record<string, unknown>>;
}

export function parseClarificationAssignmentBody(
  input: unknown,
  instance: string,
): Readonly<{ assignee_user_id: string | null }> {
  return parse(
    z
      .object({
        assignee_user_id: z
          .string()
          .regex(
            /^usr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            "Expected a usr_ UUIDv7",
          )
          .nullable(),
      })
      .strict(),
    input,
    instance,
  );
}

export function parseResourceId(
  value: string,
  field: string,
  instance: string,
): string {
  if (!prefixedUuidV7.test(value)) {
    throw validationError(instance, [
      { field, message: "Expected a prefixed UUIDv7" },
    ]);
  }
  return value;
}

export function parseClarificationId(
  value: string,
  instance: string,
): string {
  if (!clarificationIdPattern.test(value)) {
    throw validationError(instance, [
      { field: "clarificationId", message: "Expected a clr_ UUIDv7" },
    ]);
  }
  return value;
}

export function parseTraceparent(
  value: string | undefined,
  instance: string,
): string | undefined {
  if (value !== undefined && !traceparentPattern.test(value)) {
    throw validationError(instance, [
      { field: "traceparent", message: "Expected W3C traceparent" },
    ]);
  }
  return value;
}

function parse<T>(schema: z.ZodType<T>, input: unknown, instance: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw validationError(
    instance,
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "query",
      message: issue.message,
    })),
  );
}

function validationError(
  instance: string,
  fieldErrors: NonNullable<
    ConstructorParameters<typeof ActionCentreHttpError>[4]
  >,
): ActionCentreHttpError {
  return new ActionCentreHttpError(
    400,
    "INVALID_ACTION_CENTRE_REQUEST",
    "Human Action Centre request validation failed",
    instance,
    fieldErrors,
  );
}
