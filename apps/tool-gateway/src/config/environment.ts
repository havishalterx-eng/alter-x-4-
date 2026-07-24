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

function requireValue(
  environment: NodeJS.ProcessEnv,
  field: string,
): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ToolGatewayConfigurationError(
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
    throw new ToolGatewayConfigurationError(
      "PORT",
      "must be an integer from 1 to 65535",
    );
  }
  return port;
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50052";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new ToolGatewayConfigurationError(
      "GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new ToolGatewayConfigurationError(
      "GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

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
    tavilyApiKeySecretRef: requireValue(environment, "TAVILY_API_KEY_SECRET_REF"),
    auditServiceGrpcAddress: requireValue(
      environment,
      "AUDIT_SERVICE_GRPC_ADDRESS",
    ),
  };
}
