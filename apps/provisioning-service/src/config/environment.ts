export interface ProvisioningEnvironment {
  readonly localMock: boolean;
  readonly region: "ap-south-1";
  readonly e2bApiKeyReference?: string;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadProvisioningEnvironment(environment: NodeJS.ProcessEnv): ProvisioningEnvironment {
  const alterEnvironment = required(environment, "ALTER_ENV");
  if (!(["local", "dev", "staging", "prod"] as const).includes(alterEnvironment as "local")) throw new Error("ALTER_ENV is invalid");
  if (required(environment, "ALTER_SERVICE_NAME") !== "provisioning-service") throw new Error("ALTER_SERVICE_NAME must equal provisioning-service");
  if (required(environment, "ALTER_REGION") !== "ap-south-1") throw new Error("ALTER_REGION must equal ap-south-1");
  const source = required(environment, "ALTER_CONFIG_SOURCE");
  if (source === "mock") {
    if (alterEnvironment !== "local" || environment.NODE_ENV === "production") throw new Error("Mock configuration is only allowed for local non-production runs");
    return { localMock: true, region: "ap-south-1" };
  }
  if (source !== "appconfig") throw new Error("ALTER_CONFIG_SOURCE must be appconfig or mock");
  return { localMock: false, region: "ap-south-1", e2bApiKeyReference: required(environment, "E2B_API_KEY_REF") };
}
