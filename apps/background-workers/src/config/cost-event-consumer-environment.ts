import { createEnvironmentValidators } from "@alterx/adapters";

const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

export interface CostEventConsumerEnvironment {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly region: string;
  readonly costLedgerServiceAddress: string;
  readonly pollIntervalMs: number;
}

export class CostEventConsumerConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid cost-events consumer environment field ${field}: ${reason}`);
    this.name = "CostEventConsumerConfigurationError";
  }
}

const { requireValue } = createEnvironmentValidators(
  (field, reason) => new CostEventConsumerConfigurationError(field, reason),
);

export function loadCostEventConsumerEnvironment(
  environment: NodeJS.ProcessEnv,
): CostEventConsumerEnvironment {
  const alterEnvironment = requireValue(environment, "ALTER_ENV");
  if (!ALTER_ENVIRONMENTS.includes(alterEnvironment as CostEventConsumerEnvironment["alterEnvironment"])) {
    throw new CostEventConsumerConfigurationError(
      "ALTER_ENV",
      `must be one of ${ALTER_ENVIRONMENTS.join(", ")}`,
    );
  }

  const pollIntervalRaw = environment.COST_EVENTS_POLL_INTERVAL_MS?.trim();
  const pollIntervalMs = pollIntervalRaw === undefined ? 2_000 : Number(pollIntervalRaw);
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100) {
    throw new CostEventConsumerConfigurationError(
      "COST_EVENTS_POLL_INTERVAL_MS",
      "must be an integer of at least 100",
    );
  }

  return {
    alterEnvironment: alterEnvironment as CostEventConsumerEnvironment["alterEnvironment"],
    region: requireValue(environment, "ALTER_REGION"),
    costLedgerServiceAddress:
      environment.COST_LEDGER_SERVICE_ADDRESS?.trim() ?? "localhost:50060",
    pollIntervalMs,
  };
}
