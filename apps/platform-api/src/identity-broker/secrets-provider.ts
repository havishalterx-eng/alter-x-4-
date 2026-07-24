import type { SecretsProvider } from "@alterx/shared-clients";

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

  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  async getSecret(reference: string): Promise<string> {
    if (!reference.startsWith("env:")) {
      throw new Error(`Unsupported secret reference: ${reference}`);
    }

    const environmentKey = reference.slice("env:".length);
    const value = this.environment[environmentKey];
    if (!environmentKey || !value) {
      throw new Error(`Secret reference unavailable: ${reference}`);
    }

    return value.replaceAll("\\n", "\n");
  }

  async healthCheck() {
    return {
      status: "healthy" as const,
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
    };
  }
}
