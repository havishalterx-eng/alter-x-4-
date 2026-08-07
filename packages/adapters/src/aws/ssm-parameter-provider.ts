import { GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  MutableParameterStoreProvider,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

export interface AwsSsmParameterProviderConfig {
  readonly region: string;
}

export interface SsmParameterCommandClient {
  send(command: GetParameterCommand | PutParameterCommand): Promise<{
    readonly Parameter?: { readonly Value?: string };
  }>;
  destroy?(): void;
}

const CAPABILITIES: ProviderCapabilities = {
  streaming: false, tool_calling: false, vision: false, structured_output: false,
  long_context: false, regional_availability: ["ap-south-1"], data_residency: ["IN"],
  batch_support: false, maximum_payload: 4_096, supported_languages: [], cost_model: { rates: [] },
};

const METADATA: ProviderMetadata<"ParameterStoreProvider"> = {
  providerId: "aws-ssm-parameter-store", interfaceName: "ParameterStoreProvider",
  displayName: "AWS SSM Parameter Store", version: "artifact-storage-v1",
  telemetryNamespace: "alterx.adapters.aws.ssm-parameter-store", supportsTenantOverrides: false,
  migration: { strategyVersion: "aws-ssm-parameter-store-v1", rollbackSupported: true },
};

export class AwsSsmParameterProvider implements MutableParameterStoreProvider {
  readonly metadata = METADATA;
  readonly capabilities = CAPABILITIES;
  readonly #client: SsmParameterCommandClient;

  constructor(config: AwsSsmParameterProviderConfig, client?: SsmParameterCommandClient) {
    if (config.region.trim().length === 0) throw new Error("AWS SSM region is required");
    this.#client = client ?? new SSMClient({ region: config.region });
  }

  async getParameter(name: string): Promise<string> {
    if (name.length === 0 || name.trim() !== name) {
      throw new Error("Parameter name must be non-empty and trimmed");
    }
    const value = (await this.#client.send(new GetParameterCommand({ Name: name }))).Parameter?.Value;
    if (value === undefined || value.length === 0) throw new Error("Resolved parameter contains no value");
    return value;
  }

  async putParameter(name: string, value: string): Promise<void> {
    if (name.length === 0 || name.trim() !== name) {
      throw new Error("Parameter name must be non-empty and trimmed");
    }
    if (value.length === 0 || Buffer.byteLength(value, "utf8") > 4_096) {
      throw new Error("Parameter value must contain 1 to 4096 UTF-8 bytes");
    }
    await this.#client.send(new PutParameterCommand({
      Name: name,
      Value: value,
      Type: "String",
      Overwrite: true,
    }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { status: "healthy", checkedAt: new Date().toISOString(), latencyMs: 0, details: { configured: true } };
  }

  close(): void { this.#client.destroy?.(); }
}
