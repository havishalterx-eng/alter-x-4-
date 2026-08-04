import { z } from "zod";
import { EnvVarHttpError } from "./problem";
import type { CreateEnvVarInput, UpdateEnvVarInput } from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const projectIdPattern =
  /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const valueSchema = z
  .string()
  .min(1)
  .max(65_536)
  .refine((value) => value.trim().length > 0, "value cannot be blank");
const metadata = {
  environment: z.string().trim().min(1).max(100),
  key: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid environment variable key"),
};
const createSchema = z
  .object({ ...metadata, value: valueSchema })
  .strict();
const updateSchema = z
  .object({
    environment: metadata.environment.optional(),
    key: metadata.key.optional(),
    value: valueSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field required",
  );

export function parseCreateEnvVar(
  input: unknown,
  instance: string,
): CreateEnvVarInput {
  return parse(createSchema, input, instance);
}

export function parseUpdateEnvVar(
  input: unknown,
  instance: string,
): UpdateEnvVarInput {
  const parsed = parse(updateSchema, input, instance);
  return {
    ...(parsed.environment === undefined
      ? {}
      : { environment: parsed.environment }),
    ...(parsed.key === undefined ? {} : { key: parsed.key }),
    ...(parsed.value === undefined ? {} : { value: parsed.value }),
  };
}

export function parseEnvVarId(value: string, instance: string): string {
  if (!uuidPattern.test(value)) {
    throw invalid(instance, [{ field: "id", message: "Expected UUID" }]);
  }
  return value;
}

export function parseEnvVarProjectId(value: string, instance: string): string {
  if (!projectIdPattern.test(value)) {
    throw invalid(instance, [
      { field: "projectId", message: "Invalid projectId" },
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
  fields: NonNullable<ConstructorParameters<typeof EnvVarHttpError>[4]>,
): EnvVarHttpError {
  return new EnvVarHttpError(
    400,
    "INVALID_ENV_VAR_REQUEST",
    "Environment variable request validation failed",
    instance,
    fields,
  );
}
