import { z } from "zod";
import { ProjectHttpError } from "./problem";
import type {
  ProjectActionInput,
  ProjectPagination,
} from "./project-operations.types";

const prefixedIdPattern =
  /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const actionInputSchema: z.ZodType<ProjectActionInput> = z.record(
  z.string(),
  z.json(),
);

const paginationSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export function parseProjectActionInput(
  value: unknown,
  instance: string,
): ProjectActionInput {
  return parse(actionInputSchema, value === undefined ? {} : value, instance);
}

export function parseProjectPagination(
  cursor: string | undefined,
  limit: string | undefined,
  instance: string,
): ProjectPagination {
  return parse(paginationSchema, { cursor, limit }, instance);
}

export function parseDeploymentId(value: string, instance: string): string {
  return parsePrefixedId(value, "dep_", "deploymentId", instance);
}

export function parseConversationId(value: string, instance: string): string {
  return parsePrefixedId(value, "cnv_", "conversationId", instance);
}

function parse<T>(schema: z.ZodType<T>, value: unknown, instance: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new ProjectHttpError(
    400,
    "PROJECT_VALIDATION_FAILED",
    "Project request validation failed",
    instance,
    parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

function parsePrefixedId(
  value: string,
  prefix: string,
  field: string,
  instance: string,
): string {
  if (!prefixedIdPattern.test(value) || !value.startsWith(prefix)) {
    throw new ProjectHttpError(
      400,
      "PROJECT_VALIDATION_FAILED",
      "Project request validation failed",
      instance,
      [{ field, message: `Invalid ${field}` }],
    );
  }
  return value;
}
