import { createEnvironmentValidators } from "@alterx/adapters";

const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

interface CostLedgerEnvironmentBase {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly serviceName: "cost-ledger-service";
  readonly httpPort: number;
  readonly grpcBindAddress: string;
  // Real cross-service dependency for OUT-4's workspace_id resolution
  // (see RunLookupService, orchestration-service). Default matches
  // orchestration-service's own RUNS_GRPC_BIND_ADDRESS default port.
  readonly runsServiceAddress: string;
  // OUT-5: internal->billable margin. Config-driven (doc 13's "no fixed
  // credit/margin values invented" rule), not a real negotiated business
  // rate -- disclosed placeholder pending real pricing input, changeable
  // without a redeploy via env/AppConfig.
  readonly costMarginRate: number;
  // Deliberately configurable placeholder until a real FX provider exists.
  // Used only for new ingestion; historic USD rows remain immutable USD.
  readonly costUsdToInrRate: number;
  // OUT-5: secret reference (never a value) for billing_rollups.tenant_pseudonym
  // -- same real HMAC-SHA256 scheme audit-service's deletion-orchestrator
  // already establishes (doc 04 SS1: "pseudonymized survivors only in
  // cost_db and audit_db").
  readonly pseudonymKeyReference: string;
}

export interface CostLedgerIamEnvironment extends CostLedgerEnvironmentBase {
  readonly databaseAuthentication: "iam";
  readonly databaseHost: string;
  readonly databasePort: number;
  readonly databaseName: string;
  readonly databaseUser: string;
  readonly region: string;
}

export interface CostLedgerStaticEnvironment extends CostLedgerEnvironmentBase {
  readonly databaseAuthentication: "static";
  readonly databaseSecretReference: string;
}

export type CostLedgerEnvironment =
  | CostLedgerIamEnvironment
  | CostLedgerStaticEnvironment;

export class CostLedgerConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid cost-ledger-service environment field ${field}: ${reason}`);
    this.name = "CostLedgerConfigurationError";
  }
}

const { requireValue, parsePort, parseRequiredPort, parseGrpcAddress } = createEnvironmentValidators(
  (field, reason) => new CostLedgerConfigurationError(field, reason),
);

function parseMarginRate(value: string | undefined): number {
  if (value === undefined) {
    return 0.3;
  }
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    throw new CostLedgerConfigurationError(
      "COST_MARGIN_RATE",
      "must be a number from 0 (inclusive) to 1 (exclusive)",
    );
  }
  return rate;
}

function parseUsdToInrRate(value: string | undefined): number {
  const rate = Number(value ?? "83");
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new CostLedgerConfigurationError(
      "COST_USD_TO_INR_RATE",
      "must be a positive number",
    );
  }
  return rate;
}

export function loadCostLedgerEnvironment(
  environment: NodeJS.ProcessEnv,
): CostLedgerEnvironment {
  const alterEnvironment = requireValue(environment, "ALTER_ENV");
  if (
    !ALTER_ENVIRONMENTS.includes(
      alterEnvironment as CostLedgerEnvironment["alterEnvironment"],
    )
  ) {
    throw new CostLedgerConfigurationError(
      "ALTER_ENV",
      `must be one of ${ALTER_ENVIRONMENTS.join(", ")}`,
    );
  }

  const serviceName = requireValue(environment, "ALTER_SERVICE_NAME");
  if (serviceName !== "cost-ledger-service") {
    throw new CostLedgerConfigurationError(
      "ALTER_SERVICE_NAME",
      "must equal cost-ledger-service",
    );
  }

  const baseEnvironment: CostLedgerEnvironmentBase = {
    alterEnvironment: alterEnvironment as CostLedgerEnvironment["alterEnvironment"],
    serviceName,
    httpPort: parsePort(environment.PORT),
    grpcBindAddress: parseGrpcAddress(
      environment.COST_GRPC_BIND_ADDRESS,
      "COST_GRPC_BIND_ADDRESS",
      "0.0.0.0:50060",
      false,
    ),
    runsServiceAddress: environment.RUNS_SERVICE_ADDRESS?.trim() ?? "localhost:50059",
    costMarginRate: parseMarginRate(environment.COST_MARGIN_RATE),
    costUsdToInrRate: parseUsdToInrRate(environment.COST_USD_TO_INR_RATE),
    pseudonymKeyReference: requireValue(environment, "COST_PSEUDONYM_KEY_REF"),
  };

  if (alterEnvironment === "local") {
    return {
      ...baseEnvironment,
      databaseAuthentication: "static",
      databaseSecretReference: requireValue(environment, "DATABASE_SECRET_REF"),
    };
  }

  return {
    ...baseEnvironment,
    databaseAuthentication: "iam",
    databaseHost: requireValue(environment, "DATABASE_HOST"),
    databasePort: parseRequiredPort(requireValue(environment, "DATABASE_PORT"), "DATABASE_PORT"),
    databaseName: requireValue(environment, "DATABASE_NAME"),
    databaseUser: requireValue(environment, "DATABASE_USER"),
    region: requireValue(environment, "ALTER_REGION"),
  };
}
