import { createEnvironmentValidators } from "@alterx/adapters";

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

const { requireValue, parsePort, parseRequiredPort, parseGrpcAddress } =
  createEnvironmentValidators((field, reason) => new AuditConfigurationError(field, reason));

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
    grpcBindAddress: parseGrpcAddress(environment.GRPC_BIND_ADDRESS, "GRPC_BIND_ADDRESS", "0.0.0.0:50051"),
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
    databasePort: parseRequiredPort(requireValue(environment, "DATABASE_PORT"), "DATABASE_PORT"),
    databaseName: requireValue(environment, "DATABASE_NAME"),
    databaseUser: requireValue(environment, "DATABASE_USER"),
  };
}
