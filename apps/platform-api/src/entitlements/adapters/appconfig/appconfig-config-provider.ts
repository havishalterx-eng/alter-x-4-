import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  StartConfigurationSessionCommand,
  type AppConfigDataClientConfig,
} from "@aws-sdk/client-appconfigdata";
import type { ConfigProvider } from "../../config-provider.interface";
import { parseConfigDocument } from "../../config-document";
import type { AbuseThresholds, EntitlementLimits } from "../../types";

export interface AppConfigIdentifiers {
  applicationIdentifier: string;
  environmentIdentifier: string;
  configurationProfileIdentifier: string;
}

interface AppConfigClient {
  send(command: unknown): Promise<Record<string, unknown>>;
}

export class AppConfigConfigProvider implements ConfigProvider {
  private token?: string;
  private cachedDocument?: ReturnType<typeof parseConfigDocument>;

  constructor(
    private readonly identifiers: AppConfigIdentifiers,
    private readonly client: AppConfigClient = new AppConfigDataClient(
      {} as AppConfigDataClientConfig,
    ) as AppConfigClient,
  ) {}

  async getEntitlementDefaults(plan: string): Promise<EntitlementLimits> {
    const limits = (await this.getDocument()).plans[plan];
    if (!limits) {
      throw new Error(`No entitlement defaults configured for plan: ${plan}`);
    }
    return { ...limits };
  }

  async getAbuseThresholds(): Promise<AbuseThresholds> {
    return { ...(await this.getDocument()).abuse };
  }

  private async getDocument() {
    if (!this.token) {
      const session = await this.client.send(
        new StartConfigurationSessionCommand({
          ApplicationIdentifier: this.identifiers.applicationIdentifier,
          EnvironmentIdentifier: this.identifiers.environmentIdentifier,
          ConfigurationProfileIdentifier:
            this.identifiers.configurationProfileIdentifier,
        }),
      );
      const initialToken = session.InitialConfigurationToken as string | undefined;
      if (!initialToken) {
        throw new Error("AWS AppConfig did not return a configuration token");
      }
      this.token = initialToken;
    }

    const response = await this.client.send(
      new GetLatestConfigurationCommand({ ConfigurationToken: this.token }),
    );
    this.token =
      (response.NextPollConfigurationToken as string | undefined) ?? this.token;
    const configuration = response.Configuration as Uint8Array | undefined;

    if (configuration?.byteLength) {
      this.cachedDocument = parseConfigDocument(
        new TextDecoder().decode(configuration),
      );
    }
    if (!this.cachedDocument) {
      throw new Error("AWS AppConfig returned no entitlement configuration");
    }
    return this.cachedDocument;
  }
}
