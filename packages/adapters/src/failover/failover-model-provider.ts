import type { FallbackProvider } from "@alterx/contracts";
import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvocationStreamChunk,
  ModelProvider,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

export type FallbackProviderMap = Readonly<
  Partial<Record<FallbackProvider, ModelProvider>>
>;

const FAILOVER_METADATA: ProviderMetadata<"ModelProvider"> = {
  providerId: "model-gateway-failover-chain",
  interfaceName: "ModelProvider",
  displayName: "Model Gateway failover chain",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.failover",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "failover-chain-v1",
    rollbackSupported: true,
  },
};

/**
 * Wraps a primary ModelProvider (Bedrock) with an ordered chain of fallback
 * providers (Anthropic direct, OpenAI). On primary failure, tries each
 * configured fallback in the order given by the alias binding's
 * fallback_chain, using that entry's model_id instead of the primary's.
 * The fallback_chain itself is config-curated (packages/contracts
 * model-alias-policy.ts) -- this class trusts that curation rather than
 * doing its own runtime capability negotiation.
 *
 * ModelInvocationResult.servedBy always reflects whichever provider actually
 * answered, so a caller can never mistake a fallback response for the
 * primary -- "no silent downgrade".
 */
export class FailoverModelProvider implements ModelProvider {
  readonly metadata = FAILOVER_METADATA;

  readonly #primary: ModelProvider;
  readonly #fallbacks: FallbackProviderMap;

  constructor(primary: ModelProvider, fallbacks: FallbackProviderMap) {
    this.#primary = primary;
    this.#fallbacks = fallbacks;
  }

  get capabilities(): ModelProvider["capabilities"] {
    return this.#primary.capabilities;
  }

  async invoke(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    try {
      return await this.#primary.invoke(request);
    } catch (primaryError: unknown) {
      let lastError = primaryError;
      for (const entry of request.fallbackChain ?? []) {
        const fallbackProvider = this.#fallbacks[entry.provider];
        if (fallbackProvider === undefined) {
          continue;
        }
        try {
          return await fallbackProvider.invoke({
            ...request,
            modelId: entry.model_id,
          });
        } catch (fallbackError: unknown) {
          lastError = fallbackError;
        }
      }
      throw lastError;
    }
  }

  async *stream(
    request: ModelInvocationRequest,
  ): AsyncIterable<ModelInvocationStreamChunk> {
    let lastError: unknown;
    const candidates: Array<{
      provider: ModelProvider;
      request: ModelInvocationRequest;
    }> = [{ provider: this.#primary, request }];
    for (const entry of request.fallbackChain ?? []) {
      const provider = this.#fallbacks[entry.provider];
      if (provider !== undefined) {
        candidates.push({
          provider,
          request: { ...request, modelId: entry.model_id },
        });
      }
    }

    for (const candidate of candidates) {
      let emitted = false;
      try {
        for await (const chunk of candidate.provider.stream(candidate.request)) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (error: unknown) {
        if (emitted) {
          // Switching providers after bytes reached the caller would splice
          // two unrelated completions into one corrupt stream.
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError ?? new Error("No streaming model provider was available");
  }

  async healthCheck(): Promise<ProviderHealth> {
    return this.#primary.healthCheck();
  }
}
