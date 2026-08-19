import {
  ModelAliasPolicySchema,
  ProviderControlSchema,
  type ModelAlias,
  type ModelAliasBinding,
  type ModelAliasPolicy,
  type ProviderControl,
  type UpdateProviderControlRequest,
} from "@alterx/contracts";
import type { SecretsProvider } from "@alterx/shared-clients";

export interface ModelGatewayAdminClientConfig {
  readonly baseUrl?: string;
  readonly tokenSecretRef?: string;
  readonly timeoutMs: number;
}

export class ModelGatewayAdminClient {
  constructor(
    private readonly config: ModelGatewayAdminClientConfig,
    private readonly secrets: SecretsProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listProviders(): Promise<ProviderControl[]> {
    const payload = await this.call("GET", "/internal/admin/providers");
    if (!Array.isArray(payload)) throw new ModelGatewayAdminClientError("Invalid provider list");
    return payload.map((item) => ProviderControlSchema.parse(item));
  }

  async updateProvider(
    providerId: string,
    input: UpdateProviderControlRequest,
  ): Promise<ProviderControl> {
    return ProviderControlSchema.parse(await this.call(
      "PATCH",
      `/internal/admin/providers/${encodeURIComponent(providerId)}`,
      input,
    ));
  }

  async getModelPolicy(): Promise<ModelAliasPolicy> {
    return ModelAliasPolicySchema.parse(
      await this.call("GET", "/internal/admin/model-policy"),
    );
  }

  async proposeModelAlias(
    alias: ModelAlias,
    binding: ModelAliasBinding,
    reason: string,
  ): Promise<ModelAliasPolicy> {
    return ModelAliasPolicySchema.parse(await this.call(
      "PUT",
      `/internal/admin/model-policy/${alias}/proposal`,
      { binding, reason },
    ));
  }

  async promoteModelAlias(): Promise<ModelAliasPolicy> {
    return ModelAliasPolicySchema.parse(await this.call(
      "POST",
      "/internal/admin/model-policy/promote",
    ));
  }

  private async call(
    method: "GET" | "PATCH" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    if (!this.config.baseUrl || !this.config.tokenSecretRef) {
      throw new ModelGatewayAdminClientError("Model gateway admin endpoint is not configured");
    }
    const token = await this.secrets.getSecret(this.config.tokenSecretRef);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        throw new ModelGatewayAdminClientError(
          `Model gateway admin request failed with status ${response.status}`,
        );
      }
      return response.json();
    } catch (error) {
      if (error instanceof ModelGatewayAdminClientError) throw error;
      throw new ModelGatewayAdminClientError("Model gateway admin request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class ModelGatewayAdminClientError extends Error {}
