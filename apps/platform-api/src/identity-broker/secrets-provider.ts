import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { SecretsProvider } from "@alterx/shared-clients";

export interface SsmParameterClient {
  send(command: GetParameterCommand): Promise<{
    readonly Parameter?: { readonly Value?: string };
  }>;
}

export class EnvironmentSecretsProvider implements SecretsProvider {
  readonly metadata = {
    providerId: "environment.secrets",
    interfaceName: "SecretsProvider" as const,
    displayName: "Environment secrets provider",
    version: "1.0.0",
    telemetryNamespace: "alter.platform.environment_secrets",
    supportsTenantOverrides: false,
    migration: { strategyVersion: "1", rollbackSupported: true },
  };
  readonly capabilities = {
    streaming: false,
    tool_calling: false,
    vision: false,
    structured_output: true,
    long_context: false,
    regional_availability: ["runtime"],
    data_residency: ["runtime"],
    batch_support: false,
    maximum_payload: 65_536,
    supported_languages: ["en"],
    cost_model: { rates: [] },
  };

  readonly #ssm: SsmParameterClient;

  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    ssmClient?: SsmParameterClient,
  ) {
    this.#ssm = ssmClient ?? new SSMClient({
      region: environment.AWS_REGION ?? environment.AWS_DEFAULT_REGION ?? "ap-south-1",
      ...(environment.AWS_ENDPOINT_URL ? { endpoint: environment.AWS_ENDPOINT_URL } : {}),
    });
  }

  async getSecret(reference: string): Promise<string> {
    if (reference.startsWith("env:")) {
      const environmentKey = reference.slice("env:".length);
      const value = this.environment[environmentKey];
      if (!environmentKey || !value) {
        throw new Error(`Secret reference unavailable: ${reference}`);
      }

      return value.replaceAll("\\n", "\n");
    }

    if (!reference.startsWith("/")) {
      throw new Error(`Unsupported secret reference: ${reference}`);
    }

    const value = (await this.#ssm.send(new GetParameterCommand({
      Name: reference,
      WithDecryption: true,
    }))).Parameter?.Value;
    if (!value) {
      throw new Error(`Secret reference unavailable: ${reference}`);
    }
    return value;
  }

  async healthCheck() {
    return {
      status: "healthy" as const,
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
    };
  }
}
