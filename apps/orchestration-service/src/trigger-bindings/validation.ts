import {
  CreateTriggerBindingRequestSchema,
  IntegrationConnectionIdSchema,
  TriggerBindingConfigSchema,
  type CreateTriggerBindingRequest,
  type TriggerBindingConfig,
} from "@alterx/contracts";
import { z } from "zod";

export class TriggerBindingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriggerBindingValidationError";
  }
}

export class TriggerBindingNotFoundError extends Error {
  constructor(id: string) {
    super(`Trigger binding ${id} was not found`);
    this.name = "TriggerBindingNotFoundError";
  }
}

export class WebhookEndpointNotFoundError extends Error {
  constructor(id: string) {
    super(`Webhook endpoint ${id} was not found`);
    this.name = "WebhookEndpointNotFoundError";
  }
}

export class TriggerNotBindableError extends Error {
  constructor(triggerId: string, type: string) {
    super(
      `Trigger ${triggerId} has type "${type}"; only webhook triggers can be bound to an integration connection`,
    );
    this.name = "TriggerNotBindableError";
  }
}

/** Raised when the caller's workspace does not own the target trigger. */
export class TriggerBindingWorkspaceMismatchError extends Error {
  constructor(triggerId: string) {
    super(`Trigger ${triggerId} does not belong to the requested workspace`);
    this.name = "TriggerBindingWorkspaceMismatchError";
  }
}

const TRIGGER_ID_PATTERN =
  /^trg_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENDPOINT_ID_PATTERN =
  /^whe_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING_ID_PATTERN =
  /^tbn_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCreateBindingBody(
  input: unknown,
): CreateTriggerBindingRequest {
  return parse(CreateTriggerBindingRequestSchema, input, "binding request");
}

export function parseBindingConfig(input: unknown): TriggerBindingConfig {
  return parse(TriggerBindingConfigSchema, input, "binding config");
}

export function parseIntegrationId(value: string): string {
  return parse(IntegrationConnectionIdSchema, value, "integrationId");
}

export function parseTriggerId(value: string): string {
  return matching(TRIGGER_ID_PATTERN, value, "triggerId");
}

export function parseWebhookEndpointId(value: string): string {
  return matching(ENDPOINT_ID_PATTERN, value, "webhookEndpointId");
}

export function parseBindingId(value: string): string {
  return matching(BINDING_ID_PATTERN, value, "bindingId");
}

export function parseTenantId(value: string | undefined): string {
  if (value === undefined) {
    throw new TriggerBindingValidationError("tenantId is required");
  }
  return matching(UUID_PATTERN, value, "tenantId");
}

export function parseWorkspaceId(value: string | undefined): string {
  if (value === undefined) {
    throw new TriggerBindingValidationError("workspaceId is required");
  }
  return matching(UUID_PATTERN, value, "workspaceId");
}

function matching(pattern: RegExp, value: string, field: string): string {
  if (!pattern.test(value)) {
    throw new TriggerBindingValidationError(`${field} is malformed`);
  }
  return value;
}

function parse<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".") || label}: ${issue.message}`)
    .join("; ");
  throw new TriggerBindingValidationError(`Invalid ${label} -- ${detail}`);
}
