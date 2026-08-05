// ENG-BINDING configuration. Deliberately holds no secret: signing secrets
// are minted per endpoint and live in SecretsProvider, never in env.

export interface TriggerBindingEnvironment {
  /** Public origin webhook URLs are built from, e.g. https://hooks.alter.ai */
  readonly webhookBaseUrl: string;
  /** Replay bound applied to new endpoints, in seconds. */
  readonly maxSkewSeconds: number;
}

export class TriggerBindingConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid trigger binding environment field ${field}: ${reason}`);
    this.name = "TriggerBindingConfigurationError";
  }
}

const DEFAULT_MAX_SKEW_SECONDS = 300;

export function loadTriggerBindingEnvironment(
  environment: NodeJS.ProcessEnv,
): TriggerBindingEnvironment {
  const rawUrl = environment.WEBHOOK_PUBLIC_BASE_URL?.trim();
  if (rawUrl === undefined || rawUrl.length === 0) {
    throw new TriggerBindingConfigurationError(
      "WEBHOOK_PUBLIC_BASE_URL",
      "a non-empty value is required",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TriggerBindingConfigurationError(
      "WEBHOOK_PUBLIC_BASE_URL",
      "must be an absolute URL",
    );
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    // Signed webhooks over plaintext HTTP would expose payloads in transit;
    // loopback is allowed so the eval harness and local runs work.
    throw new TriggerBindingConfigurationError(
      "WEBHOOK_PUBLIC_BASE_URL",
      "must use https outside loopback",
    );
  }

  return {
    webhookBaseUrl: rawUrl.replace(/\/+$/, ""),
    maxSkewSeconds: parseSkew(environment.WEBHOOK_MAX_SKEW_SECONDS),
  };
}

function parseSkew(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_MAX_SKEW_SECONDS;
  }
  const parsed = Number(value);
  // Bounds mirror webhook_endpoints_max_skew_seconds_check in migration 0022.
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 900) {
    throw new TriggerBindingConfigurationError(
      "WEBHOOK_MAX_SKEW_SECONDS",
      "must be an integer between 30 and 900",
    );
  }
  return parsed;
}
