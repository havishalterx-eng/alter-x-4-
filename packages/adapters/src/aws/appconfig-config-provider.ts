import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  StartConfigurationSessionCommand,
} from "@aws-sdk/client-appconfigdata";

import {
  ModelAliasPolicySchema,
  type ModelAlias,
  type ModelAliasBinding,
  type ProviderCapabilities,
} from "@alterx/contracts";
import {
  ModelAliasResolutionError,
  type ConfigProvider,
  type ProviderHealth,
  type ProviderMetadata,
  type ToolPermissionBinding,
  type ToolPermissionRequest,
} from "@alterx/shared-clients";

export interface AwsAppConfigConfigProviderConfig {
  readonly region: string;
  readonly applicationIdentifier: string;
  readonly environmentIdentifier: string;
  readonly configurationProfileIdentifier: string;
  readonly requiredMinimumPollIntervalSeconds?: number;
}

export interface AppConfigDataCommandClient {
  send(
    command: StartConfigurationSessionCommand,
  ): Promise<{ readonly InitialConfigurationToken?: string }>;
  send(command: GetLatestConfigurationCommand): Promise<{
    readonly Configuration?: Uint8Array;
    readonly NextPollConfigurationToken?: string;
  }>;
  destroy?(): void;
}

export const APPCONFIG_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 65_536,
  supported_languages: [],
  cost_model: { rates: [] },
};

const APPCONFIG_METADATA: ProviderMetadata<"ConfigProvider"> = {
  providerId: "aws-appconfig",
  interfaceName: "ConfigProvider",
  displayName: "AWS AppConfig runtime policy",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.aws.appconfig",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-appconfig-v1",
    rollbackSupported: true,
  },
};

export class AwsAppConfigConfigProvider implements ConfigProvider {
  readonly metadata = APPCONFIG_METADATA;
  readonly capabilities = APPCONFIG_CAPABILITIES;

  readonly #client: AppConfigDataCommandClient;
  readonly #config: AwsAppConfigConfigProviderConfig;
  readonly #now: () => Date;
  #sessionToken: string | undefined;
  #cachedPolicy: ReturnType<typeof ModelAliasPolicySchema.parse> | undefined;

  constructor(
    config: AwsAppConfigConfigProviderConfig,
    client?: AppConfigDataCommandClient,
    now?: () => Date,
  ) {
    if (config.applicationIdentifier.trim().length === 0) {
      throw new Error("AppConfig application identifier is required");
    }
    if (config.environmentIdentifier.trim().length === 0) {
      throw new Error("AppConfig environment identifier is required");
    }
    if (config.configurationProfileIdentifier.trim().length === 0) {
      throw new Error(
        "AppConfig configuration profile identifier is required",
      );
    }
    this.#config = config;
    this.#client =
      client ?? new AppConfigDataClient({ region: config.region });
    this.#now = now ?? (() => new Date());
  }

  async resolveModelAlias(alias: ModelAlias): Promise<ModelAliasBinding> {
    const policy = await this.#fetchPolicy();
    const binding = policy.bindings[alias];
    if (binding === undefined) {
      throw new ModelAliasResolutionError(alias);
    }
    return binding;
  }

  async resolveToolPermission(
    request: ToolPermissionRequest,
  ): Promise<ToolPermissionBinding> {
    const policy = await this.#fetchPolicy();
    const tenantSpecific =
      policy.tool_permissions?.[`${request.tenantId}:${request.toolName}`];
    const globalForTool = policy.tool_permissions?.[`*:${request.toolName}`];
    const binding = tenantSpecific ?? globalForTool;
    if (binding === undefined) {
      return {
        allowed: false,
        rateLimitPerMinute: 1,
        requiredScopes: [],
      };
    }
    return {
      allowed: binding.allowed,
      rateLimitPerMinute: binding.rate_limit_per_minute,
      requiredScopes: binding.required_scopes,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = this.#now().toISOString();
    try {
      await this.#fetchPolicy();
      return {
        status: "healthy",
        checkedAt,
        latencyMs: 0,
        details: { configured: true },
      };
    } catch (error: unknown) {
      return {
        status: "unhealthy",
        checkedAt,
        latencyMs: 0,
        details: {
          configured: true,
          reason: error instanceof Error ? error.message : "unknown error",
        },
      };
    }
  }

  close(): void {
    this.#client.destroy?.();
  }

  async #fetchPolicy() {
    const token = await this.#nextToken();
    const response = await this.#client.send(
      new GetLatestConfigurationCommand({
        ConfigurationToken: token,
      }),
    );
    this.#sessionToken = response.NextPollConfigurationToken;

    if (response.Configuration === undefined || response.Configuration.length === 0) {
      // AppConfig returns an empty payload when the deployed configuration
      // has not changed since the last poll; the caller must keep using the
      // last-fetched policy in that case.
      if (this.#cachedPolicy === undefined) {
        throw new Error(
          "AppConfig returned no configuration and no policy has been cached yet",
        );
      }
      return this.#cachedPolicy;
    }

    const raw = JSON.parse(Buffer.from(response.Configuration).toString("utf8"));
    const policy = ModelAliasPolicySchema.parse(raw);
    this.#cachedPolicy = policy;
    return policy;
  }

  async #nextToken(): Promise<string> {
    if (this.#sessionToken !== undefined) {
      return this.#sessionToken;
    }
    const session = await this.#client.send(
      new StartConfigurationSessionCommand({
        ApplicationIdentifier: this.#config.applicationIdentifier,
        EnvironmentIdentifier: this.#config.environmentIdentifier,
        ConfigurationProfileIdentifier:
          this.#config.configurationProfileIdentifier,
        RequiredMinimumPollIntervalInSeconds:
          this.#config.requiredMinimumPollIntervalSeconds,
      }),
    );
    if (session.InitialConfigurationToken === undefined) {
      throw new Error(
        "AppConfig did not return an initial configuration token",
      );
    }
    return session.InitialConfigurationToken;
  }
}
