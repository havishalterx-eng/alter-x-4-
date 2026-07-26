import { z } from "zod";
import { CredentialHttpError } from "./problem";
import type { CreateCredentialInput, UpdateCredentialInput } from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secret = z
  .string()
  .min(1)
  .max(65_536)
  .refine((value) => value.trim().length > 0, "value cannot be blank");
const metadata = {
  name: z.string().trim().min(1).max(160),
  connector: z.string().trim().min(1).max(100),
  scope: z.string().trim().min(1).max(200),
};
const createSchema = z.object({ ...metadata, value: secret }).strict();
const updateSchema = z
  .object({
    name: metadata.name.optional(),
    connector: metadata.connector.optional(),
    scope: metadata.scope.optional(),
    value: secret.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field required");

export function parseCreateCredential(
  input: unknown,
  instance: string,
): CreateCredentialInput {
  return parse(createSchema, input, instance);
}

export function parseUpdateCredential(
  input: unknown,
  instance: string,
): UpdateCredentialInput {
  const parsed = parse(updateSchema, input, instance);
  return {
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.connector === undefined ? {} : { connector: parsed.connector }),
    ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
    ...(parsed.value === undefined ? {} : { value: parsed.value }),
  };
}

export function parseCredentialId(value: string, instance: string): string {
  if (!uuidPattern.test(value)) {
    throw invalid(instance, [{ field: "id", message: "Expected UUID" }]);
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
  fields: NonNullable<ConstructorParameters<typeof CredentialHttpError>[4]>,
): CredentialHttpError {
  return new CredentialHttpError(
    400,
    "INVALID_CREDENTIAL_REQUEST",
    "Credential request validation failed",
    instance,
    fields,
  );
}
