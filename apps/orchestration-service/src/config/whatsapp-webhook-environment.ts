import { createEnvironmentValidators } from "@alterx/adapters";

// Config for the WhatsApp webhook data plane (INGR-6) only. Kept separate
// from Session Gateway's config (app.module.ts) and the Conversation
// Manager's config (./environment.ts) -- same reasoning as those: this
// ticket must not perturb either's wiring.

export interface WhatsappWebhookEnvironment {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly timestampSkewSeconds: number;
}

export class WhatsappWebhookConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid WhatsApp webhook environment field ${field}: ${reason}`);
    this.name = "WhatsappWebhookConfigurationError";
  }
}

const { requireValue } = createEnvironmentValidators(
  (field, reason) => new WhatsappWebhookConfigurationError(field, reason),
);

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
    timestampSkewSeconds: parseSkewSeconds(
      environment.WHATSAPP_TIMESTAMP_SKEW_SECONDS,
    ),
  };
}
