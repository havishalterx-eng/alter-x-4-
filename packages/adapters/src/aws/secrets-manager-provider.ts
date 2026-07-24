import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ProviderHealth,
  ProviderMetadata,
  SecretsProvider,
} from "@alterx/shared-clients";

export interface AwsSecretsManagerConfig {
  readonly region: string;
}

export interface SecretsManagerCommandClient {
  send(command: GetSecretValueCommand): Promise<{
    readonly SecretString?: string;
    readonly SecretBinary?: Uint8Array;
  }>;
  destroy?(): void;
}

const AWS_SECRETS_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: false,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 65_536,
  supported_languages: [],
  cost_model: { rates: [] },
};

const AWS_SECRETS_METADATA: ProviderMetadata<"SecretsProvider"> = {
  providerId: "aws-secrets-manager",
  interfaceName: "SecretsProvider",
  displayName: "AWS Secrets Manager",
  version: "foundation-v1",
  telemetryNamespace: "alterx.adapters.aws.secrets-manager",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-secrets-manager-v1",
    rollbackSupported: true,
  },
};

export class AwsSecretsManagerProvider implements SecretsProvider {
  readonly metadata = AWS_SECRETS_METADATA;
  readonly capabilities = AWS_SECRETS_CAPABILITIES;

  readonly #client: SecretsManagerCommandClient;

  constructor(config: AwsSecretsManagerConfig, client?: SecretsManagerCommandClient) {
    if (config.region.trim().length === 0) {
      throw new Error("AWS Secrets Manager region is required");
    }
    this.#client = client ?? new SecretsManagerClient({ region: config.region });
  }

  async getSecret(referenceId: string): Promise<string> {
    if (referenceId.length === 0 || referenceId.trim() !== referenceId) {
      throw new Error("Secret reference ID must be non-empty and trimmed");
    }
    const response = await this.#client.send(
      new GetSecretValueCommand({ SecretId: referenceId }),
    );
    const value =
      response.SecretString ??
      (response.SecretBinary === undefined
        ? undefined
        : Buffer.from(response.SecretBinary).toString("utf8"));
    if (value === undefined || value.length === 0) {
      throw new Error("Resolved secret contains no value");
    }
    return value;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      details: { configured: true },
    };
  }

  close(): void {
    this.#client.destroy?.();
  }
}
