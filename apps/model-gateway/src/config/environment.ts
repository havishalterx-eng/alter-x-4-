const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

interface ModelGatewayEnvironmentBase {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly serviceName: "model-gateway";
  readonly region: "ap-south-1";
  readonly httpPort: number;
  readonly grpcBindAddress: string;
}

export interface ModelGatewayAppConfigEnvironment
  extends ModelGatewayEnvironmentBase {
  readonly configSource: "appconfig";
  readonly appConfigApplicationId: string;
  readonly appConfigEnvironmentId: string;
  readonly appConfigConfigurationProfileId: string;
  readonly anthropicApiKeySecretReference: string;
  readonly openaiApiKeySecretReference: string;
  readonly presidioAnalyzerUrl: string;
  readonly presidioAnonymizerUrl: string;
  readonly cacheRedisHost: string;
  readonly cacheRedisPort: number;
  readonly platformAdminServiceTokenSecretReference: string;
  readonly providerControlParameterName: string;
  readonly modelPolicyOverrideParameterName: string;
}

export interface ModelGatewayMockEnvironment
  extends ModelGatewayEnvironmentBase {
  readonly configSource: "mock";
}

export type ModelGatewayEnvironment =
  | ModelGatewayAppConfigEnvironment
  | ModelGatewayMockEnvironment;

export class ModelGatewayConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid model-gateway environment field ${field}: ${reason}`);
    this.name = "ModelGatewayConfigurationError";
  }
}

function requireValue(
  environment: NodeJS.ProcessEnv,
  field: string,
): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ModelGatewayConfigurationError(
      field,
      "a non-empty value is required",
    );
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ModelGatewayConfigurationError(
      "PORT",
      "must be an integer from 1 to 65535",
    );
  }
  return port;
}

function parseRequiredPort(field: string, value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ModelGatewayConfigurationError(
      field,
      "must be an integer from 1 to 65535",
    );
  }
  return port;
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50051";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new ModelGatewayConfigurationError(
      "GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new ModelGatewayConfigurationError(
      "GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadModelGatewayEnvironment(
  environment: NodeJS.ProcessEnv,
): ModelGatewayEnvironment {
  const alterEnvironment = requireValue(environment, "ALTER_ENV");
  if (
    !ALTER_ENVIRONMENTS.includes(
      alterEnvironment as ModelGatewayEnvironment["alterEnvironment"],
    )
  ) {
    throw new ModelGatewayConfigurationError(
      "ALTER_ENV",
      `must be one of ${ALTER_ENVIRONMENTS.join(", ")}`,
    );
  }

  const serviceName = requireValue(environment, "ALTER_SERVICE_NAME");
  if (serviceName !== "model-gateway") {
    throw new ModelGatewayConfigurationError(
      "ALTER_SERVICE_NAME",
      "must equal model-gateway",
    );
  }

  const region = requireValue(environment, "ALTER_REGION");
  if (region !== "ap-south-1") {
    throw new ModelGatewayConfigurationError(
      "ALTER_REGION",
      "must equal ap-south-1",
    );
  }

  const configSource = requireValue(environment, "ALTER_CONFIG_SOURCE");
  if (configSource !== "appconfig" && configSource !== "mock") {
    throw new ModelGatewayConfigurationError(
      "ALTER_CONFIG_SOURCE",
      "must be one of appconfig, mock",
    );
  }
  if (configSource === "mock" && alterEnvironment !== "local") {
    throw new ModelGatewayConfigurationError(
      "ALTER_CONFIG_SOURCE",
      "mock config source is only permitted when ALTER_ENV is local",
    );
  }
  if (configSource === "mock" && environment.NODE_ENV === "production") {
    throw new ModelGatewayConfigurationError(
      "ALTER_CONFIG_SOURCE",
      "mock config source cannot be selected when NODE_ENV is production",
    );
  }

  const baseEnvironment: ModelGatewayEnvironmentBase = {
    alterEnvironment:
      alterEnvironment as ModelGatewayEnvironment["alterEnvironment"],
    serviceName,
    region,
    httpPort: parsePort(environment.PORT),
    grpcBindAddress: parseGrpcAddress(environment.GRPC_BIND_ADDRESS),
  };

  if (configSource === "mock") {
    return { ...baseEnvironment, configSource: "mock" };
  }

  return {
    ...baseEnvironment,
    configSource: "appconfig",
    appConfigApplicationId: requireValue(
      environment,
      "APPCONFIG_APPLICATION_ID",
    ),
    appConfigEnvironmentId: requireValue(
      environment,
      "APPCONFIG_ENVIRONMENT_ID",
    ),
    appConfigConfigurationProfileId: requireValue(
      environment,
      "APPCONFIG_CONFIGURATION_PROFILE_ID",
    ),
    anthropicApiKeySecretReference: requireValue(
      environment,
      "ANTHROPIC_API_KEY_SECRET_REF",
    ),
    openaiApiKeySecretReference: requireValue(
      environment,
      "OPENAI_API_KEY_SECRET_REF",
    ),
    presidioAnalyzerUrl: requireValue(environment, "PRESIDIO_ANALYZER_URL"),
    presidioAnonymizerUrl: requireValue(
      environment,
      "PRESIDIO_ANONYMIZER_URL",
    ),
    cacheRedisHost: requireValue(environment, "CACHE_REDIS_HOST"),
    cacheRedisPort: parseRequiredPort(
      "CACHE_REDIS_PORT",
      requireValue(environment, "CACHE_REDIS_PORT"),
    ),
    platformAdminServiceTokenSecretReference: requireValue(
      environment,
      "PLATFORM_ADMIN_SERVICE_TOKEN_SECRET_REF",
    ),
    providerControlParameterName:
      environment.PROVIDER_CONTROL_PARAMETER_NAME?.trim() ||
      `/alter/${alterEnvironment}/model-gateway/provider-controls`,
    modelPolicyOverrideParameterName:
      environment.MODEL_POLICY_OVERRIDE_PARAMETER_NAME?.trim() ||
      `/alter/${alterEnvironment}/model-gateway/model-policy`,
  };
}
