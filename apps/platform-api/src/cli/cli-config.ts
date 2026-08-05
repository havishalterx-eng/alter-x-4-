import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  StartConfigurationSessionCommand,
  type AppConfigDataClientConfig,
} from "@aws-sdk/client-appconfigdata";

export const CLI_CONFIG_PROVIDER = Symbol("CLI_CONFIG_PROVIDER");

export interface CliPolicy {
  minimumCliVersion: string;
  deviceFlowRateLimitPerMinute: number;
}

export interface CliConfigProvider {
  getCliPolicy(): Promise<CliPolicy>;
}

interface AppConfigClient {
  send(command: unknown): Promise<Record<string, unknown>>;
}

export class AppConfigCliConfigProvider implements CliConfigProvider {
  private token?: string;
  private cachedPolicy?: CliPolicy;

  constructor(
    private readonly identifiers: {
      applicationIdentifier: string;
      environmentIdentifier: string;
      configurationProfileIdentifier: string;
    },
    private readonly client: AppConfigClient = new AppConfigDataClient(
      {} as AppConfigDataClientConfig,
    ) as AppConfigClient,
  ) {}

  async getCliPolicy(): Promise<CliPolicy> {
    if (!this.token) {
      const session = await this.client.send(
        new StartConfigurationSessionCommand({
          ApplicationIdentifier: this.identifiers.applicationIdentifier,
          EnvironmentIdentifier: this.identifiers.environmentIdentifier,
          ConfigurationProfileIdentifier: this.identifiers.configurationProfileIdentifier,
        }),
      );
      const token = session.InitialConfigurationToken as string | undefined;
      if (!token) throw new Error("AWS AppConfig did not return a configuration token");
      this.token = token;
    }

    const response = await this.client.send(
      new GetLatestConfigurationCommand({ ConfigurationToken: this.token }),
    );
    this.token =
      (response.NextPollConfigurationToken as string | undefined) ?? this.token;
    const configuration = response.Configuration as Uint8Array | undefined;
    if (configuration?.byteLength) {
      this.cachedPolicy = parseCliPolicy(new TextDecoder().decode(configuration));
    }
    if (!this.cachedPolicy) throw new Error("AWS AppConfig returned no CLI configuration");
    return { ...this.cachedPolicy };
  }
}

export function cliConfigProviderFromEnvironment(): CliConfigProvider {
  if (process.env.ALTER_CONFIG_SOURCE !== "appconfig") {
    return { getCliPolicy: async () => { throw new Error("CLI policy requires AppConfig"); } };
  }
  const applicationIdentifier = process.env.APPCONFIG_APP_ID;
  const environmentIdentifier = process.env.APPCONFIG_ENV_ID;
  const configurationProfileIdentifier = process.env.APPCONFIG_PROFILE_ID;
  if (!applicationIdentifier || !environmentIdentifier || !configurationProfileIdentifier) {
    return { getCliPolicy: async () => { throw new Error("CLI AppConfig identifiers unavailable"); } };
  }
  return new AppConfigCliConfigProvider({
    applicationIdentifier,
    environmentIdentifier,
    configurationProfileIdentifier,
  });
}

function parseCliPolicy(input: string): CliPolicy {
  const parsed: unknown = JSON.parse(input);
  if (!parsed || typeof parsed !== "object") throw new Error("CLI AppConfig must be an object");
  const document = parsed as Record<string, unknown>;
  if (!isVersion(document.minimum_cli_version)) {
    throw new Error("CLI AppConfig minimum_cli_version must be a semantic version");
  }
  if (
    typeof document.device_flow_rate_limit_per_minute !== "number" ||
    !Number.isInteger(document.device_flow_rate_limit_per_minute) ||
    document.device_flow_rate_limit_per_minute < 1
  ) {
    throw new Error("CLI AppConfig device_flow_rate_limit_per_minute must be a positive integer");
  }
  return {
    minimumCliVersion: document.minimum_cli_version,
    deviceFlowRateLimitPerMinute: document.device_flow_rate_limit_per_minute,
  };
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}
