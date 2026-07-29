const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;
const CONFIG_SOURCES = ["appconfig", "local-file"] as const;

interface AuditEnvironmentBase {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly serviceName: "audit-service";
  readonly region: "ap-south-1";
  readonly configSource: (typeof CONFIG_SOURCES)[number];
  readonly auditArchiveBucketParameter: string;
  readonly httpPort: number;
  readonly grpcBindAddress: string;
  readonly adsDeletionBaseUrl: string;
  readonly orchestrationDeletionBaseUrl: string;
  readonly deletionPseudonymKeyReference: string;
  readonly deletionServiceTokenReference: string;
}

export interface AuditIamEnvironment extends AuditEnvironmentBase {
  readonly databaseAuthentication: "iam";
  readonly databaseHost: string;
  readonly databasePort: number;
  readonly databaseName: string;
  readonly databaseUser: string;
}

export interface AuditStaticEnvironment extends AuditEnvironmentBase {
  readonly databaseAuthentication: "static";
  readonly databaseSecretReference: string;
}

export type AuditEnvironment = AuditIamEnvironment | AuditStaticEnvironment;

export class AuditConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid audit-service environment field ${field}: ${reason}`);
    this.name = "AuditConfigurationError";
  }
}

function requireValue(
  environment: NodeJS.ProcessEnv,
  field: string,
): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new AuditConfigurationError(field, "a non-empty value is required");
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new AuditConfigurationError("PORT", "must be an integer from 1 to 65535");
  }
  return port;
}

function parseDatabasePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new AuditConfigurationError(
      "DATABASE_PORT",
      "must be an integer from 1 to 65535",
    );
  }
  return port;
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50051";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new AuditConfigurationError(
      "GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new AuditConfigurationError(
      "GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadAuditEnvironment(
  environment: NodeJS.ProcessEnv,
): AuditEnvironment {
  const alterEnvironment = requireValue(environment, "ALTER_ENV");
  if (!ALTER_ENVIRONMENTS.includes(alterEnvironment as AuditEnvironment["alterEnvironment"])) {
    throw new AuditConfigurationError(
      "ALTER_ENV",
      `must be one of ${ALTER_ENVIRONMENTS.join(", ")}`,
    );
  }
  if (
    alterEnvironment === "local" &&
    environment.NODE_ENV === "production"
  ) {
    throw new AuditConfigurationError(
      "ALTER_ENV",
      "local cannot select static database authentication when NODE_ENV is production",
    );
  }

  const serviceName = requireValue(environment, "ALTER_SERVICE_NAME");
  if (serviceName !== "audit-service") {
    throw new AuditConfigurationError(
      "ALTER_SERVICE_NAME",
      "must equal audit-service",
    );
  }

  const region = requireValue(environment, "ALTER_REGION");
  if (region !== "ap-south-1") {
    throw new AuditConfigurationError(
      "ALTER_REGION",
      "must equal ap-south-1",
    );
  }

  const configSource = requireValue(environment, "ALTER_CONFIG_SOURCE");
  if (!CONFIG_SOURCES.includes(configSource as AuditEnvironment["configSource"])) {
    throw new AuditConfigurationError(
      "ALTER_CONFIG_SOURCE",
      `must be one of ${CONFIG_SOURCES.join(", ")}`,
    );
  }

  const baseEnvironment: AuditEnvironmentBase = {
    alterEnvironment:
      alterEnvironment as AuditEnvironment["alterEnvironment"],
    serviceName,
    region,
    configSource: configSource as AuditEnvironment["configSource"],
    auditArchiveBucketParameter: requireValue(
      environment,
      "AUDIT_ARCHIVE_BUCKET_PARAM",
    ),
    httpPort: parsePort(environment.PORT),
    grpcBindAddress: parseGrpcAddress(environment.GRPC_BIND_ADDRESS),
    adsDeletionBaseUrl: requireValue(environment, "ADS_DELETION_BASE_URL"),
    orchestrationDeletionBaseUrl: requireValue(environment, "ORCHESTRATION_DELETION_BASE_URL"),
    deletionPseudonymKeyReference: requireValue(environment, "DELETION_PSEUDONYM_KEY_REF"),
    deletionServiceTokenReference: requireValue(environment, "DELETION_SERVICE_TOKEN_REF"),
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
  };
}
