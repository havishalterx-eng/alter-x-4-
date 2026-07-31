const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

interface CostLedgerEnvironmentBase {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly serviceName: "cost-ledger-service";
  readonly httpPort: number;
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

function requireValue(environment: NodeJS.ProcessEnv, field: string): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new CostLedgerConfigurationError(field, "a non-empty value is required");
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CostLedgerConfigurationError("PORT", "must be an integer from 1 to 65535");
  }
  return port;
}

function parseDatabasePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CostLedgerConfigurationError(
      "DATABASE_PORT",
      "must be an integer from 1 to 65535",
    );
  }
  return port;
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
    databasePort: parseDatabasePort(requireValue(environment, "DATABASE_PORT")),
    databaseName: requireValue(environment, "DATABASE_NAME"),
    databaseUser: requireValue(environment, "DATABASE_USER"),
    region: requireValue(environment, "ALTER_REGION"),
  };
}
