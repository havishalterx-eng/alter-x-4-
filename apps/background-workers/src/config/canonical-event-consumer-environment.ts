const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

export interface CanonicalEventConsumerEnvironment {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly region: string;
  readonly orchestrationRunsAddress: string;
  readonly pollIntervalMs: number;
}

export class CanonicalEventConsumerConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(
      `Invalid canonical-events consumer environment field ${field}: ${reason}`,
    );
    this.name = "CanonicalEventConsumerConfigurationError";
  }
}

function requireValue(environment: NodeJS.ProcessEnv, field: string): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new CanonicalEventConsumerConfigurationError(
      field,
      "a non-empty value is required",
    );
  }
  return value;
}

export function loadCanonicalEventConsumerEnvironment(
  environment: NodeJS.ProcessEnv,
): CanonicalEventConsumerEnvironment {
  const alterEnvironment = requireValue(environment, "ALTER_ENV");
  if (
    !ALTER_ENVIRONMENTS.includes(
      alterEnvironment as CanonicalEventConsumerEnvironment["alterEnvironment"],
    )
  ) {
    throw new CanonicalEventConsumerConfigurationError(
      "ALTER_ENV",
      `must be one of ${ALTER_ENVIRONMENTS.join(", ")}`,
    );
  }

  const pollIntervalRaw = environment.CANONICAL_EVENTS_POLL_INTERVAL_MS?.trim();
  const pollIntervalMs =
    pollIntervalRaw === undefined ? 2_000 : Number(pollIntervalRaw);
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100) {
    throw new CanonicalEventConsumerConfigurationError(
      "CANONICAL_EVENTS_POLL_INTERVAL_MS",
      "must be an integer of at least 100",
    );
  }

  return {
    alterEnvironment: alterEnvironment as CanonicalEventConsumerEnvironment["alterEnvironment"],
    region: requireValue(environment, "ALTER_REGION"),
    orchestrationRunsAddress:
      environment.ORCHESTRATION_RUNS_ADDRESS?.trim() ?? "127.0.0.1:50077",
    pollIntervalMs,
  };
}