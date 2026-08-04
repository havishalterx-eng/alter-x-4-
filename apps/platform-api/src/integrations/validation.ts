import { z } from "zod";
import { isConnectorId } from "./connectors";
import { IntegrationHttpError } from "./problem";
import type { OAuthAuthorizeInput, OAuthCallbackInput } from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const authorizeSchema: z.ZodType<OAuthAuthorizeInput> = z
  .object({
    redirect_uri: z.url(),
  })
  .strict();

const callbackSchema: z.ZodType<OAuthCallbackInput> = z
  .object({
    code: z.string().min(1),
    state: z.string().min(1),
  })
  .strict();

export function parseConnectorId(value: string, instance: string): string {
  if (!isConnectorId(value)) {
    throw validationError(instance, [
      { field: "connector", message: `Unsupported connector: ${value}` },
    ]);
  }
  return value;
}

export function parseConnectionId(value: string, instance: string): string {
  if (!uuidPattern.test(value)) {
    throw validationError(instance, [
      { field: "connectionId", message: "Invalid connectionId" },
    ]);
  }
  return value;
}

export function parseOAuthAuthorizeInput(
  value: unknown,
  instance: string,
): OAuthAuthorizeInput {
  return parse(authorizeSchema, value, instance);
}

export function parseOAuthCallbackInput(
  value: unknown,
  instance: string,
): OAuthCallbackInput {
  return parse(callbackSchema, value, instance);
}

function parse<T>(schema: z.ZodType<T>, value: unknown, instance: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw validationError(
    instance,
    parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

function validationError(
  instance: string,
  fieldErrors: Array<{ field: string; message: string }>,
): IntegrationHttpError {
  return new IntegrationHttpError(
    400,
    "INTEGRATION_VALIDATION_FAILED",
    "Integration request validation failed",
    instance,
    fieldErrors,
  );
}
