import { createEnvironmentValidators } from "@alterx/adapters";

const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

interface ToolGatewayEnvironmentBase {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly serviceName: "tool-gateway";
  readonly region: "ap-south-1";
  readonly httpPort: number;
  readonly grpcBindAddress: string;
}

export interface ToolGatewayAppConfigEnvironment
  extends ToolGatewayEnvironmentBase {
  readonly configSource: "appconfig";
  readonly appConfigApplicationId: string;
  readonly appConfigEnvironmentId: string;
  readonly appConfigConfigurationProfileId: string;
  readonly tavilyApiKeySecretRef: string;
  readonly auditServiceGrpcAddress: string;
  readonly cacheRedisHost: string;
  readonly cacheRedisPort: number;
  // ENGINE-RESTRUCTURE-P4-1b: same fields/env vars sandbox-service's
  // createBrowserProvider consumed before the browser tools moved here.
  readonly browserbaseApiKeyReference: string;
  readonly browserbaseProjectId: string;
}

export interface ToolGatewayMockEnvironment
  extends ToolGatewayEnvironmentBase {
  readonly configSource: "mock";
}

export type ToolGatewayEnvironment =
  | ToolGatewayAppConfigEnvironment
  | ToolGatewayMockEnvironment;

export class ToolGatewayConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid tool-gateway environment field ${field}: ${reason}`);
    this.name = "ToolGatewayConfigurationError";
  }
}

const { requireValue, parsePort, parseRequiredPort, parseGrpcAddress } =
  createEnvironmentValidators((field, reason) => new ToolGatewayConfigurationError(field, reason));

export function loadToolGatewayEnvironment(
  environment: NodeJS.ProcessEnv,
): ToolGatewayEnvironment {
  const alterEnvironment = requireValue(environment, "ALTER_ENV");
  if (
    !ALTER_ENVIRONMENTS.includes(
      alterEnvironment as ToolGatewayEnvironment["alterEnvironment"],
    )
  ) {
    throw new ToolGatewayConfigurationError(
      "ALTER_ENV",
      `must be one of ${ALTER_ENVIRONMENTS.join(", ")}`,
    );
  }

  const serviceName = requireValue(environment, "ALTER_SERVICE_NAME");
  if (serviceName !== "tool-gateway") {
    throw new ToolGatewayConfigurationError(
      "ALTER_SERVICE_NAME",
      "must equal tool-gateway",
    );
  }

  const region = requireValue(environment, "ALTER_REGION");
  if (region !== "ap-south-1") {
    throw new ToolGatewayConfigurationError(
      "ALTER_REGION",
      "must equal ap-south-1",
    );
  }

  const configSource = requireValue(environment, "ALTER_CONFIG_SOURCE");
  if (configSource !== "appconfig" && configSource !== "mock") {
    throw new ToolGatewayConfigurationError(
      "ALTER_CONFIG_SOURCE",
      "must be one of appconfig, mock",
    );
  }
  if (configSource === "mock" && alterEnvironment !== "local") {
    throw new ToolGatewayConfigurationError(
      "ALTER_CONFIG_SOURCE",
      "mock config source is only permitted when ALTER_ENV is local",
    );
  }
  if (configSource === "mock" && environment.NODE_ENV === "production") {
    throw new ToolGatewayConfigurationError(
      "ALTER_CONFIG_SOURCE",
      "mock config source cannot be selected when NODE_ENV is production",
    );
  }

  const baseEnvironment: ToolGatewayEnvironmentBase = {
    alterEnvironment:
      alterEnvironment as ToolGatewayEnvironment["alterEnvironment"],
    serviceName,
    region,
    httpPort: parsePort(environment.PORT),
    grpcBindAddress: parseGrpcAddress(environment.GRPC_BIND_ADDRESS, "GRPC_BIND_ADDRESS", "0.0.0.0:50052"),
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
    tavilyApiKeySecretRef: requireValue(environment, "TAVILY_API_KEY_SECRET_REF"),
    auditServiceGrpcAddress: requireValue(
      environment,
      "AUDIT_SERVICE_GRPC_ADDRESS",
    ),
    cacheRedisHost: requireValue(environment, "CACHE_REDIS_HOST"),
    cacheRedisPort: parseRequiredPort(
      requireValue(environment, "CACHE_REDIS_PORT"),
      "CACHE_REDIS_PORT",
    ),
    browserbaseApiKeyReference: requireValue(
      environment,
      "BROWSERBASE_API_KEY_REF",
    ),
    browserbaseProjectId: requireValue(environment, "BROWSERBASE_PROJECT_ID"),
  };
}
