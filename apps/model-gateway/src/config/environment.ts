import { createEnvironmentValidators } from "@alterx/adapters";

const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

interface ModelGatewayEnvironmentBase {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly serviceName: "model-gateway";
  readonly region: "ap-south-1";
  readonly httpPort: number;
  readonly grpcBindAddress: string;
  readonly costLedgerGrpcAddress: string;
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

const { requireValue, parsePort, parseRequiredPort, parseGrpcAddress } =
  createEnvironmentValidators((field, reason) => new ModelGatewayConfigurationError(field, reason));

/**
 * Non-empty-with-default, no address-format validation -- unlike
 * GRPC_BIND_ADDRESS (this process's own bind target, always a raw IPv4:port),
 * a cross-service target address is real-world commonly a hostname (k8s
 * service DNS, docker-compose service name), matching the base test fixture's
 * own pre-existing "localhost:50060" value. Defaults rather than throws when
 * absent because the real pricing lookup this feeds is fail-open by design
 * (ENGINE-FIX-16) -- an unreachable default degrades to the historical-
 * average fallback, it never breaks boot.
 */
function optionalAddress(value: string | undefined, defaultAddress: string): string {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : defaultAddress;
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
    grpcBindAddress: parseGrpcAddress(environment.GRPC_BIND_ADDRESS, "GRPC_BIND_ADDRESS", "0.0.0.0:50051"),
    // No fixed port is documented anywhere for cost-ledger-service's real
    // gRPC bind address (it isn't part of the standard local-dev compose
    // stack) -- 50065 picked to sit in the same numeric range as this
    // repo's other real cross-service gRPC defaults (e.g. 50054, 50071,
    // 50077). Real deployments always override via COST_LEDGER_GRPC_ADDRESS.
    costLedgerGrpcAddress: optionalAddress(
      environment.COST_LEDGER_GRPC_ADDRESS,
      "127.0.0.1:50065",
    ),
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
      requireValue(environment, "CACHE_REDIS_PORT"),
      "CACHE_REDIS_PORT",
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
