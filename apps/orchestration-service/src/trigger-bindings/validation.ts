import {
  CreateTriggerBindingRequestSchema,
  IntegrationConnectionIdSchema,
  TenantIdSchema,
  TriggerBindingConfigSchema,
  TriggerBindingIdSchema,
  TriggerIdSchema,
  WebhookEndpointIdSchema,
  WorkspaceIdSchema,
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
  return parse(TriggerIdSchema, value, "triggerId");
}

export function parseWebhookEndpointId(value: string): string {
  return parse(WebhookEndpointIdSchema, value, "webhookEndpointId");
}

export function parseBindingId(value: string): string {
  return parse(TriggerBindingIdSchema, value, "bindingId");
}

// ENGINE-FIX-P3-20: these two validated against a BARE (unprefixed) UUID --
// every real tenantId/workspaceId in this system is `ten_`/`ws_` prefixed
// (TenantIdSchema/WorkspaceIdSchema, already defined in @alterx/contracts
// and already used correctly two lines up for triggerId/bindingId/
// webhookEndpointId in this same file). request.actorContext.tenant_id
// (trigger-binding.controller.ts) is always the prefixed form, so this
// made every real call into bindTrigger/listBindings/disableBinding/
// getEndpointForIntegration throw "tenantId is malformed" -- the feature
// was unreachable with any real tenant. Masked by this file's own test
// fixtures using bare UUIDs too (fixed alongside this).
export function parseTenantId(value: string | undefined): string {
  if (value === undefined) {
    throw new TriggerBindingValidationError("tenantId is required");
  }
  return parse(TenantIdSchema, value, "tenantId");
}

export function parseWorkspaceId(value: string | undefined): string {
  if (value === undefined) {
    throw new TriggerBindingValidationError("workspaceId is required");
  }
  return parse(WorkspaceIdSchema, value, "workspaceId");
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
