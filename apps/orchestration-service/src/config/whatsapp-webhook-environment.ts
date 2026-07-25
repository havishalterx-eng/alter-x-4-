// Config for the WhatsApp webhook data plane (INGR-6) only. Kept separate
// from Session Gateway's config (app.module.ts) and the Conversation
// Manager's config (./environment.ts) -- same reasoning as those: this
// ticket must not perturb either's wiring.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface WhatsappWebhookEnvironment {
  readonly appSecret: string;
  readonly verifyToken: string;
  // WhatsApp webhooks have no established phone_number_id -> tenant
  // registry yet (no such mapping exists anywhere in the codebase). Until
  // one exists, this ticket serves exactly one configured tenant per
  // deployment -- a disclosed, deliberate scope limit, not an oversight.
  // See PR "Known gaps".
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly timestampSkewSeconds: number;
}

export class WhatsappWebhookConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid WhatsApp webhook environment field ${field}: ${reason}`);
    this.name = "WhatsappWebhookConfigurationError";
  }
}

function requireValue(environment: NodeJS.ProcessEnv, field: string): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new WhatsappWebhookConfigurationError(
      field,
      "a non-empty value is required",
    );
  }
  return value;
}

function requireUuid(environment: NodeJS.ProcessEnv, field: string): string {
  const value = requireValue(environment, field);
  if (!UUID_PATTERN.test(value)) {
    throw new WhatsappWebhookConfigurationError(field, "must be a UUID");
  }
  return value;
}

function parseSkewSeconds(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return 300;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new WhatsappWebhookConfigurationError(
      "WHATSAPP_TIMESTAMP_SKEW_SECONDS",
      "must be a positive integer",
    );
  }
  return parsed;
}

export function loadWhatsappWebhookEnvironment(
  environment: NodeJS.ProcessEnv,
): WhatsappWebhookEnvironment {
  return {
    appSecret: requireValue(environment, "WHATSAPP_APP_SECRET"),
    verifyToken: requireValue(environment, "WHATSAPP_VERIFY_TOKEN"),
    tenantId: requireUuid(environment, "WHATSAPP_TENANT_ID"),
    workspaceId: requireUuid(environment, "WHATSAPP_WORKSPACE_ID"),
    timestampSkewSeconds: parseSkewSeconds(
      environment.WHATSAPP_TIMESTAMP_SKEW_SECONDS,
    ),
  };
}
