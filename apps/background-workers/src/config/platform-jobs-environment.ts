// Config for the Platform Jobs handlers + digest scheduler runner
// (Engagement Phase, doc 12). Own file, same reasoning as every other
// per-ticket environment loader in this monorepo.

export interface PlatformJobsEnvironment {
  readonly platformApiInternalBaseUrl: string;
  readonly notificationDigestServiceTokenRef: string;
  readonly notificationDigestIntervalMs: number;
  readonly connectorHealthSweepServiceTokenRef: string;
  readonly connectorHealthSweepIntervalMs: number;
  readonly adsCoreInternalBaseUrl: string;
  readonly retentionSweepServiceTokenRef: string;
  readonly retentionSweepIntervalMs: number;
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
const DEFAULT_CONNECTOR_HEALTH_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const DEFAULT_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

function parseIntervalMs(
  environment: NodeJS.ProcessEnv,
  field: string,
  defaultMs: number,
): number {
  const raw = environment[field]?.trim();
  const intervalMs = raw ? Number(raw) : defaultMs;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new PlatformJobsConfigurationError(field, "must be a positive number when set");
  }
  return intervalMs;
}

export function loadPlatformJobsEnvironment(
  environment: NodeJS.ProcessEnv,
): PlatformJobsEnvironment {
  return {
    platformApiInternalBaseUrl: requireValue(environment, "PLATFORM_API_INTERNAL_BASE_URL"),
    notificationDigestServiceTokenRef: requireValue(
      environment,
      "NOTIFICATION_DIGEST_SERVICE_TOKEN_REF",
    ),
    notificationDigestIntervalMs: parseIntervalMs(
      environment,
      "NOTIFICATION_DIGEST_INTERVAL_MS",
      DEFAULT_DIGEST_INTERVAL_MS,
    ),
    connectorHealthSweepServiceTokenRef: requireValue(
      environment,
      "CONNECTOR_HEALTH_SWEEP_SERVICE_TOKEN_REF",
    ),
    connectorHealthSweepIntervalMs: parseIntervalMs(
      environment,
      "CONNECTOR_HEALTH_SWEEP_INTERVAL_MS",
      DEFAULT_CONNECTOR_HEALTH_SWEEP_INTERVAL_MS,
    ),
    adsCoreInternalBaseUrl: requireValue(environment, "ADS_CORE_INTERNAL_BASE_URL"),
    retentionSweepServiceTokenRef: requireValue(
      environment,
      "RETENTION_SWEEP_SERVICE_TOKEN_REF",
    ),
    retentionSweepIntervalMs: parseIntervalMs(
      environment,
      "RETENTION_SWEEP_INTERVAL_MS",
      DEFAULT_RETENTION_SWEEP_INTERVAL_MS,
    ),
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
