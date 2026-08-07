import type { FallbackProvider } from "@alterx/contracts";
import type {
  MutableParameterStoreProvider,
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvocationStreamChunk,
  ModelProvider,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";
import { randomUUID } from "node:crypto";

export type FallbackProviderMap = Readonly<
  Partial<Record<FallbackProvider, ModelProvider>>
>;

export interface FailoverControlOptions {
  readonly store: MutableParameterStoreProvider;
  readonly parameterName: string;
}

export interface ModelProviderControlState {
  readonly providerId: string;
  readonly health: ProviderHealth["status"];
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly active: boolean;
  readonly configurationRevision: string;
  readonly fallbackChain: readonly string[];
}

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
  readonly #controlOptions: FailoverControlOptions | undefined;
  readonly #active = new Map<string, boolean>();
  #fallbackOrder: string[];
  #configurationRevision = "runtime-default";

  constructor(
    primary: ModelProvider,
    fallbacks: FallbackProviderMap,
    controlOptions?: FailoverControlOptions,
  ) {
    this.#primary = primary;
    this.#fallbacks = fallbacks;
    this.#controlOptions = controlOptions;
    this.#active.set(primary.metadata.providerId, true);
    for (const provider of Object.values(fallbacks)) {
      if (provider) this.#active.set(provider.metadata.providerId, true);
    }
    this.#fallbackOrder = Object.values(fallbacks)
      .filter((provider): provider is ModelProvider => provider !== undefined)
      .map((provider) => provider.metadata.providerId);
  }

  get capabilities(): ModelProvider["capabilities"] {
    return this.#primary.capabilities;
  }

  async invoke(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    let lastError: unknown = new ManagedModelProviderUnavailableError(
      "No active model provider was available",
    );
    if (this.isActive(this.#primary)) {
      try {
        return await this.#primary.invoke(request);
      } catch (primaryError: unknown) {
        lastError = primaryError;
      }
    }
    for (const entry of this.orderedFallbacks(request)) {
        const fallbackProvider = this.#fallbacks[entry.provider];
        if (fallbackProvider === undefined || !this.isActive(fallbackProvider)) {
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

  async *stream(
    request: ModelInvocationRequest,
  ): AsyncIterable<ModelInvocationStreamChunk> {
    let lastError: unknown;
    const candidates: Array<{
      provider: ModelProvider;
      request: ModelInvocationRequest;
    }> = this.isActive(this.#primary)
      ? [{ provider: this.#primary, request }]
      : [];
    for (const entry of this.orderedFallbacks(request)) {
      const provider = this.#fallbacks[entry.provider];
      if (provider !== undefined && this.isActive(provider)) {
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

  async hydrateControls(): Promise<void> {
    if (!this.#controlOptions) return;
    try {
      const raw = await this.#controlOptions.store.getParameter(
        this.#controlOptions.parameterName,
      );
      this.applyPersistedState(parseControlState(raw));
    } catch (error) {
      if (!isMissingParameter(error)) throw error;
    }
  }

  async getProviderControls(): Promise<ModelProviderControlState[]> {
    const providers = [
      this.#primary,
      ...Object.values(this.#fallbacks).filter(
        (provider): provider is ModelProvider => provider !== undefined,
      ),
    ];
    return Promise.all(providers.map(async (provider) => {
      let health: ProviderHealth;
      try {
        health = await provider.healthCheck();
      } catch {
        health = {
          status: "unhealthy",
          checkedAt: new Date().toISOString(),
          latencyMs: 0,
          details: { probe_failed: true },
        };
      }
      return {
        providerId: provider.metadata.providerId,
        health: health.status,
        checkedAt: health.checkedAt,
        latencyMs: health.latencyMs,
        active: this.isActive(provider),
        configurationRevision: this.#configurationRevision,
        fallbackChain: [...this.#fallbackOrder],
      };
    }));
  }

  async updateProviderControl(
    providerId: string,
    update: { readonly active?: boolean; readonly fallbackChain?: readonly string[] },
  ): Promise<ModelProviderControlState> {
    const provider = this.providerById(providerId);
    if (!provider) throw new ManagedModelProviderNotFoundError(providerId);
    const previousActive = new Map(this.#active);
    const previousFallbackOrder = [...this.#fallbackOrder];
    const previousRevision = this.#configurationRevision;
    if (update.active !== undefined) this.#active.set(providerId, update.active);
    if (update.fallbackChain !== undefined) {
      if (providerId !== this.#primary.metadata.providerId) {
        throw new ManagedModelProviderControlError(
          "Fallback chain can only be set on the primary provider",
        );
      }
      const allowed = new Set(
        Object.values(this.#fallbacks)
          .filter((item): item is ModelProvider => item !== undefined)
          .map((item) => item.metadata.providerId),
      );
      if (
        new Set(update.fallbackChain).size !== update.fallbackChain.length ||
        update.fallbackChain.some((id) => !allowed.has(id))
      ) {
        throw new ManagedModelProviderControlError(
          "Fallback chain contains an unknown or duplicate provider",
        );
      }
      this.#fallbackOrder = [...update.fallbackChain];
    }
    this.#configurationRevision = randomUUID();
    try {
      await this.persistControls();
    } catch (error) {
      this.#active.clear();
      for (const [id, active] of previousActive) this.#active.set(id, active);
      this.#fallbackOrder = previousFallbackOrder;
      this.#configurationRevision = previousRevision;
      throw error;
    }
    return (await this.getProviderControls()).find(
      (control) => control.providerId === providerId,
    )!;
  }

  private orderedFallbacks(request: ModelInvocationRequest) {
    const configured = request.fallbackChain ?? [];
    if (!this.#controlOptions) return configured;
    const byProviderId = new Map<string, (typeof configured)[number]>();
    for (const entry of configured) {
      const provider = this.#fallbacks[entry.provider];
      if (provider) byProviderId.set(provider.metadata.providerId, entry);
    }
    return this.#fallbackOrder.flatMap((providerId) => {
      const entry = byProviderId.get(providerId);
      return entry ? [entry] : [];
    });
  }

  private isActive(provider: ModelProvider): boolean {
    return this.#active.get(provider.metadata.providerId) === true;
  }

  private providerById(providerId: string): ModelProvider | undefined {
    if (this.#primary.metadata.providerId === providerId) return this.#primary;
    return Object.values(this.#fallbacks).find(
      (provider) => provider?.metadata.providerId === providerId,
    );
  }

  private applyPersistedState(state: PersistedControlState): void {
    for (const providerId of this.#active.keys()) {
      const active = state.active[providerId];
      if (typeof active === "boolean") this.#active.set(providerId, active);
    }
    const allowed = new Set(this.#active.keys());
    allowed.delete(this.#primary.metadata.providerId);
    if (
      new Set(state.fallback_chain).size === state.fallback_chain.length &&
      state.fallback_chain.every((id) => allowed.has(id))
    ) {
      this.#fallbackOrder = [...state.fallback_chain];
    }
    this.#configurationRevision = state.revision;
  }

  private async persistControls(): Promise<void> {
    if (!this.#controlOptions) return;
    await this.#controlOptions.store.putParameter(
      this.#controlOptions.parameterName,
      JSON.stringify({
        revision: this.#configurationRevision,
        active: Object.fromEntries(this.#active),
        fallback_chain: this.#fallbackOrder,
      } satisfies PersistedControlState),
    );
  }
}

interface PersistedControlState {
  readonly revision: string;
  readonly active: Readonly<Record<string, boolean>>;
  readonly fallback_chain: readonly string[];
}

function parseControlState(raw: string): PersistedControlState {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManagedModelProviderControlError("Stored provider controls are invalid");
  }
  const state = value as Record<string, unknown>;
  if (
    typeof state.revision !== "string" || state.revision.length === 0 ||
    !state.active || typeof state.active !== "object" || Array.isArray(state.active) ||
    !Array.isArray(state.fallback_chain) ||
    state.fallback_chain.some((id) => typeof id !== "string")
  ) {
    throw new ManagedModelProviderControlError("Stored provider controls are invalid");
  }
  return state as unknown as PersistedControlState;
}

function isMissingParameter(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "ParameterNotFound" || /not found/i.test(error.message));
}

export class ManagedModelProviderControlError extends Error {}
export class ManagedModelProviderNotFoundError extends ManagedModelProviderControlError {
  constructor(providerId: string) {
    super(`Unknown model provider: ${providerId}`);
  }
}
export class ManagedModelProviderUnavailableError extends Error {}
