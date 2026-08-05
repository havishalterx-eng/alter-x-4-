// Config for the Platform Jobs handlers + digest scheduler runner
// (Engagement Phase, doc 12). Own file, same reasoning as every other
// per-ticket environment loader in this monorepo.

export interface PlatformJobsEnvironment {
  readonly platformApiInternalBaseUrl: string;
  readonly notificationDigestServiceTokenRef: string;
  readonly notificationDigestIntervalMs: number;
}

export class PlatformJobsConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Platform Jobs environment field ${field}: ${reason}`);
    this.name = "PlatformJobsConfigurationError";
  }
}

function requireValue(environment: NodeJS.ProcessEnv, field: string): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new PlatformJobsConfigurationError(field, "a non-empty value is required");
  }
  return value;
}

const DEFAULT_DIGEST_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function loadPlatformJobsEnvironment(
  environment: NodeJS.ProcessEnv,
): PlatformJobsEnvironment {
  const intervalRaw = environment.NOTIFICATION_DIGEST_INTERVAL_MS?.trim();
  const intervalMs = intervalRaw ? Number(intervalRaw) : DEFAULT_DIGEST_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new PlatformJobsConfigurationError(
      "NOTIFICATION_DIGEST_INTERVAL_MS",
      "must be a positive number when set",
    );
  }
  return {
    platformApiInternalBaseUrl: requireValue(environment, "PLATFORM_API_INTERNAL_BASE_URL"),
    notificationDigestServiceTokenRef: requireValue(
      environment,
      "NOTIFICATION_DIGEST_SERVICE_TOKEN_REF",
    ),
    notificationDigestIntervalMs: intervalMs,
  };
}

/** Mirrors platform-api's own resolveRuntimeSecret shape exactly (apps
 * don't import each other's internals in this monorepo -- duplicated
 * on purpose, same real behavior). */
export async function resolveRuntimeSecret(reference: string): Promise<string> {
  const environmentKey = reference.startsWith("env:") ? reference.slice("env:".length) : reference;
  const value = process.env[environmentKey];
  if (!value) {
    throw new Error(`Secret reference unavailable: ${reference}`);
  }
  return value;
}
