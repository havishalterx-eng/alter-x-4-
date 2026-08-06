import {
  CreateTriggerBindingRequestSchema,
  IntegrationConnectionIdSchema,
  TriggerBindingIdSchema,
  TriggerIdSchema,
  type CreateTriggerBindingRequest,
} from "@alterx/contracts";
import { TriggerHttpError } from "./problem";

interface SafeSchema<T> {
  safeParse(input: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly {
            readonly path: readonly PropertyKey[];
            readonly message: string;
          }[];
        };
      };
}

export function parseCreateTriggerBinding(
  input: unknown,
  instance: string,
): CreateTriggerBindingRequest {
  return parse(CreateTriggerBindingRequestSchema, input, instance, "body");
}

export function parseBindingTriggerId(value: string, instance: string): string {
  return parse(TriggerIdSchema, value, instance, "triggerId");
}

export function parseTriggerBindingId(value: string, instance: string): string {
  return parse(TriggerBindingIdSchema, value, instance, "bindingId");
}

export function parseIntegrationConnectionId(
  value: string,
  instance: string,
): string {
  return parse(IntegrationConnectionIdSchema, value, instance, "integrationId");
}

function parse<T>(
  schema: SafeSchema<T>,
  input: unknown,
  instance: string,
  fallbackField: string,
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new TriggerHttpError(
    400,
    "INVALID_TRIGGER_BINDING_REQUEST",
    "Trigger binding request validation failed",
    instance,
    result.error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || fallbackField,
      message: issue.message,
    })),
  );
}
