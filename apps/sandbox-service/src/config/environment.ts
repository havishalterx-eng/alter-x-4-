const ALTER_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;

interface SandboxEnvironmentBase {
  readonly alterEnvironment: (typeof ALTER_ENVIRONMENTS)[number];
  readonly region: "ap-south-1";
}

export interface SandboxMockEnvironment extends SandboxEnvironmentBase {
  readonly configSource: "mock";
  readonly localMock: true;
}

export interface SandboxAppConfigEnvironment extends SandboxEnvironmentBase {
  readonly configSource: "appconfig";
  readonly localMock: false;
  readonly appConfigApplicationId: string;
  readonly appConfigEnvironmentId: string;
  readonly appConfigConfigurationProfileId: string;
  readonly e2bApiKeyReference: string;
  readonly browserbaseApiKeyReference: string;
  readonly browserbaseProjectId: string;
}

export type SandboxEnvironment =
  | SandboxMockEnvironment
  | SandboxAppConfigEnvironment;

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadSandboxEnvironment(
  environment: NodeJS.ProcessEnv,
): SandboxEnvironment {
  const alterEnvironment = required(environment, "ALTER_ENV");
  if (
    !ALTER_ENVIRONMENTS.includes(
      alterEnvironment as SandboxEnvironment["alterEnvironment"],
    )
  ) {
    throw new Error("ALTER_ENV is invalid");
  }
  if (required(environment, "ALTER_SERVICE_NAME") !== "sandbox-service") {
    throw new Error("ALTER_SERVICE_NAME must equal sandbox-service");
  }
  if (required(environment, "ALTER_REGION") !== "ap-south-1") {
    throw new Error("ALTER_REGION must equal ap-south-1");
  }
  const base = {
    alterEnvironment:
      alterEnvironment as SandboxEnvironment["alterEnvironment"],
    region: "ap-south-1" as const,
  };
  const source = required(environment, "ALTER_CONFIG_SOURCE");
  if (source === "mock") {
    if (alterEnvironment !== "local" || environment.NODE_ENV === "production") {
      throw new Error(
        "Mock configuration is only allowed for local non-production runs",
      );
    }
    return { ...base, configSource: "mock", localMock: true };
  }
  if (source !== "appconfig") {
    throw new Error("ALTER_CONFIG_SOURCE must be appconfig or mock");
  }
  return {
    ...base,
    configSource: "appconfig",
    localMock: false,
    appConfigApplicationId: required(environment, "APPCONFIG_APPLICATION_ID"),
    appConfigEnvironmentId: required(environment, "APPCONFIG_ENVIRONMENT_ID"),
    appConfigConfigurationProfileId: required(
      environment,
      "APPCONFIG_CONFIGURATION_PROFILE_ID",
    ),
    e2bApiKeyReference: required(environment, "E2B_API_KEY_REF"),
    browserbaseApiKeyReference: required(
      environment,
      "BROWSERBASE_API_KEY_REF",
    ),
    browserbaseProjectId: required(environment, "BROWSERBASE_PROJECT_ID"),
  };
}
