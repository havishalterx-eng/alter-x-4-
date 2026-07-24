import {
  ModelAliasSchema,
  ModelInvocationUsageSchema,
  type ModelgwInvokeRequest,
  type ModelgwInvokeResponse,
  type ModelgwRedactRequest,
  type ModelgwRedactResponse,
} from "@alterx/contracts";
import type { ModelgwHandler } from "@alterx/adapters";
import {
  InvalidModelAliasError,
  ModelGatewayCostLimitExceededError,
  ModelGatewayInvalidResponseError,
  type CacheProvider,
  type ConfigProvider,
  type EmbeddingProvider,
  type ModelProvider,
  type PIIRedactionProvider,
  type QueueProvider,
} from "@alterx/shared-clients";

import { costEventId } from "./cost-event-id";

// Rough per-token estimate used only to enforce a spend ceiling before real
// provider billing data is available. NOT a billing-accurate figure --
// Cost Ledger (Output phase, OUT-4) will replace this with real per-model,
// per-provider rates once they exist.
const ESTIMATED_USD_PER_TOKEN = 0.00001;

const CACHE_EMBEDDING_DIMENSIONS = 512;

interface CachedInvokeValue {
  readonly output_json: string;
  readonly usage_json: string;
  readonly resolved_capability: string;
}

function parseCachedInvokeValue(
  valueJson: string,
): CachedInvokeValue | undefined {
  try {
    const parsed = JSON.parse(valueJson) as Partial<CachedInvokeValue>;
    if (
      typeof parsed.output_json !== "string" ||
      typeof parsed.usage_json !== "string" ||
      typeof parsed.resolved_capability !== "string"
    ) {
      return undefined;
    }
    return {
      output_json: parsed.output_json,
      usage_json: parsed.usage_json,
      resolved_capability: parsed.resolved_capability,
    };
  } catch {
    return undefined;
  }
}

export class ModelGatewayService implements ModelgwHandler {
  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly modelProvider: ModelProvider,
    private readonly piiRedactionProvider: PIIRedactionProvider,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly cacheProvider: CacheProvider,
    private readonly queueProvider: QueueProvider,
    private readonly costEventsQueueName: string,
  ) {}

  async invoke(request: ModelgwInvokeRequest): Promise<ModelgwInvokeResponse> {
    const parsedAlias = ModelAliasSchema.safeParse(request.model_alias);
    if (!parsedAlias.success) {
      throw new InvalidModelAliasError(request.model_alias);
    }
    const alias = parsedAlias.data;

    const binding = await this.configProvider.resolveModelAlias(alias);
    // Every payload leaving this gateway toward a model provider is scrubbed
    // for PII first -- defense in depth even if a caller forgot to invoke
    // the standalone Redact RPC on the content itself. The semantic cache
    // below is keyed on this redacted text too, so a cache hit can never
    // leak PII that would not have left the gateway on a cache miss either.
    const redacted = await this.piiRedactionProvider.redact({
      tenantId: request.tenant_id,
      text: request.input_json,
    });

    // Embedded once and reused for both the lookup and (on a miss) the
    // store below -- computing it twice would double the embedding
    // provider's cost on every cache miss for no benefit, since the text
    // being embedded is identical both times.
    const embedding = await this.#embedBestEffort(
      request.tenant_id,
      redacted.redactedText,
    );

    const cacheHit = await this.#lookupCacheBestEffort(
      request.tenant_id,
      embedding,
    );
    if (cacheHit !== undefined) {
      return cacheHit;
    }

    const result = await this.modelProvider.invoke({
      tenantId: request.tenant_id,
      runId: request.run_id,
      nodeExecutionId: request.node_execution_id,
      modelId: binding.model_id,
      capabilityTags: binding.capability_tags,
      inputJson: redacted.redactedText,
      ...(binding.fallback_chain === undefined
        ? {}
        : { fallbackChain: binding.fallback_chain }),
    });

    // Validation floor: the response must be well-formed JSON that decodes
    // to an object (not a bare string/number/array/null). This is a shape
    // check, not a content check -- it catches a provider adapter returning
    // garbage, not a "wrong answer" from the model itself.
    this.#validateOutputShape(result.outputJson);

    const usage = this.#parseUsage(result.usageJson);
    const totalTokens = usage.input_tokens + usage.output_tokens;
    const estimatedCostUsd = totalTokens * ESTIMATED_USD_PER_TOKEN;

    const limit = await this.configProvider.resolveCostLimit({
      tenantId: request.tenant_id,
      runId: request.run_id,
    });

    // The spend already happened by the time we can measure it -- emit the
    // cost event for what was actually used before deciding whether to
    // reject the call, so an over-limit call is never invisible to the
    // (future) Cost Ledger.
    await this.#emitCostEventBestEffort(
      request,
      result.servedBy,
      result.usageJson,
      estimatedCostUsd,
    );

    if (totalTokens > limit.maxTokensPerCall) {
      throw new ModelGatewayCostLimitExceededError(
        `${totalTokens} tokens exceeds the resolved limit of ${limit.maxTokensPerCall} tokens for tenant ${request.tenant_id}`,
      );
    }
    if (estimatedCostUsd > limit.maxCostUsdPerCall) {
      throw new ModelGatewayCostLimitExceededError(
        `estimated $${estimatedCostUsd.toFixed(4)} exceeds the resolved limit of $${limit.maxCostUsdPerCall} for tenant ${request.tenant_id}`,
      );
    }

    const response: ModelgwInvokeResponse = {
      output_json: result.outputJson,
      usage_json: result.usageJson,
      // Always names both the alias tier resolved AND the concrete
      // provider that actually served it, e.g. "STANDARD:aws-bedrock" on
      // the normal path or "STANDARD:anthropic-direct" when GATE-3's
      // failover chain kicked in -- never a silent downgrade.
      resolved_capability: `${alias}:${result.servedBy}`,
    };

    await this.#storeCacheBestEffort(request.tenant_id, embedding, response);

    return response;
  }

  async redact(request: ModelgwRedactRequest): Promise<ModelgwRedactResponse> {
    const result = await this.piiRedactionProvider.redact({
      tenantId: request.tenant_id,
      text: request.content,
    });
    return {
      redacted_content: result.redactedText,
      redaction_count: result.entities.length,
    };
  }

  #validateOutputShape(outputJson: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputJson);
    } catch {
      throw new ModelGatewayInvalidResponseError(
        "output_json is not valid JSON",
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new ModelGatewayInvalidResponseError(
        "output_json must decode to a JSON object",
      );
    }
  }

  #parseUsage(usageJson: string) {
    const parsedResult = ModelInvocationUsageSchema.safeParse(
      (() => {
        try {
          return JSON.parse(usageJson);
        } catch {
          return undefined;
        }
      })(),
    );
    if (!parsedResult.success) {
      throw new ModelGatewayInvalidResponseError(
        "usage_json does not conform to the shared token-usage contract",
      );
    }
    return parsedResult.data;
  }

  async #emitCostEventBestEffort(
    request: ModelgwInvokeRequest,
    providerReference: string,
    usageJson: string,
    estimatedCostUsd: number,
  ): Promise<void> {
    try {
      await this.queueProvider.publish(this.costEventsQueueName, {
        tenant_id: request.tenant_id,
        cost_event_id: costEventId(),
        run_id: request.run_id,
        node_execution_id: request.node_execution_id,
        provider_reference: providerReference,
        usage_json: usageJson,
        amount_json: JSON.stringify({
          usd: estimatedCostUsd,
          estimated: true,
        }),
      });
    } catch {
      // Cost-event emission is best-effort: an unreachable or throttled
      // queue must never block returning an otherwise-successful model
      // response to the caller. The Cost Ledger will simply be missing
      // this event -- acceptable, unlike blocking the whole gateway.
    }
  }

  async #lookupCacheBestEffort(
    tenantId: string,
    embedding: readonly number[] | undefined,
  ): Promise<ModelgwInvokeResponse | undefined> {
    if (embedding === undefined) {
      return undefined;
    }
    try {
      const lookup = await this.cacheProvider.lookupSemantic({
        tenantId,
        embedding,
      });
      if (!lookup.hit || lookup.valueJson === undefined) {
        return undefined;
      }
      return parseCachedInvokeValue(lookup.valueJson);
    } catch {
      // The semantic cache is a pre-spend optimization, not a correctness
      // requirement -- any failure here (cache provider down, corrupt
      // cached value) must fall through to a real model invocation, never
      // fail the request.
      return undefined;
    }
  }

  async #storeCacheBestEffort(
    tenantId: string,
    embedding: readonly number[] | undefined,
    response: ModelgwInvokeResponse,
  ): Promise<void> {
    if (embedding === undefined) {
      return;
    }
    try {
      await this.cacheProvider.storeSemantic({
        tenantId,
        embedding,
        valueJson: JSON.stringify(response),
      });
    } catch {
      // Never fail an otherwise-successful model invocation because the
      // cache write failed.
    }
  }

  async #embedBestEffort(
    tenantId: string,
    text: string,
  ): Promise<readonly number[] | undefined> {
    try {
      const result = await this.embeddingProvider.embed({
        tenantId,
        text,
        dimensions: CACHE_EMBEDDING_DIMENSIONS,
      });
      return result.vector;
    } catch {
      // Embedding failure disables the cache for this call only -- never
      // fail the request over a pre-spend optimization.
      return undefined;
    }
  }
}
