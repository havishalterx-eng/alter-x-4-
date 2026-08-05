export interface ProvisioningEnvironment {
  readonly localMock: boolean;
  readonly region: "ap-south-1";
  readonly grpcBindAddress: string;
  readonly e2bApiKeyReference?: string;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseGrpcBindAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50055";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new Error(
      "PROVISIONING_GRPC_BIND_ADDRESS must be an IPv4 address and port",
    );
  }
  return address;
}

export function loadProvisioningEnvironment(environment: NodeJS.ProcessEnv): ProvisioningEnvironment {
  const alterEnvironment = required(environment, "ALTER_ENV");
  if (!(["local", "dev", "staging", "prod"] as const).includes(alterEnvironment as "local")) throw new Error("ALTER_ENV is invalid");
  if (required(environment, "ALTER_SERVICE_NAME") !== "provisioning-service") throw new Error("ALTER_SERVICE_NAME must equal provisioning-service");
  if (required(environment, "ALTER_REGION") !== "ap-south-1") throw new Error("ALTER_REGION must equal ap-south-1");
  const source = required(environment, "ALTER_CONFIG_SOURCE");
  if (source === "mock") {
    if (alterEnvironment !== "local" || environment.NODE_ENV === "production") throw new Error("Mock configuration is only allowed for local non-production runs");
    return {
      localMock: true,
      region: "ap-south-1",
      grpcBindAddress: parseGrpcBindAddress(
        environment.PROVISIONING_GRPC_BIND_ADDRESS,
      ),
    };
  }
  if (source !== "appconfig") throw new Error("ALTER_CONFIG_SOURCE must be appconfig or mock");
  return {
    localMock: false,
    region: "ap-south-1",
    grpcBindAddress: parseGrpcBindAddress(
      environment.PROVISIONING_GRPC_BIND_ADDRESS,
    ),
    e2bApiKeyReference: required(environment, "E2B_API_KEY_REF"),
  };
}
