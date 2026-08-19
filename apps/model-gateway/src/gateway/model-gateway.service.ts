import {
  ModelAliasSchema,
  ModelInvocationUsageSchema,
  type ModelgwEmbedRequest,
  type ModelgwEmbedResponse,
  type ModelgwInvokeRequest,
  type ModelgwInvokeResponse,
  type ModelgwRedactRequest,
  type ModelgwRedactResponse,
  type ModelgwStreamRequest,
  type ModelgwStreamResponse,
} from "@alterx/contracts";
import type { ModelgwHandler } from "@alterx/adapters";
import {
  InvalidModelAliasError,
  ModelGatewayCostLimitExceededError,
  ModelGatewayInvalidResponseError,
  type CacheProvider,
  type ConfigProvider,
  type EmbeddingDimensions,
  type EmbeddingProvider,
  type ModelProvider,
  type PIIRedactionProvider,
  type QueueProvider,
} from "@alterx/shared-clients";
import type { CostHandlerClient } from "@alterx/adapters";

import { costEventId } from "./cost-event-id";

// Constant used as a last-resort fallback if Cost Ledger is unreachable.
const ESTIMATED_USD_PER_TOKEN = 0.00001;

// 1 USD = 83 INR
const FALLBACK_USD_TO_INR_RATE = 83;
const COST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const CACHE_EMBEDDING_DIMENSIONS = 512;

export class InvalidEmbeddingDimensionsError extends Error {
  constructor(dimensions: number) {
    super(`Embedding dimensions must be 512 or 1024, got ${dimensions}`);
    this.name = "InvalidEmbeddingDimensionsError";
  }
}

interface CachedInvokeValue {
  readonly output_json: string;
  readonly usage_json: string;
  readonly resolved_capability: string;
}

function parseCachedInvokeValue(
  valueJson: string,
): ModelgwInvokeResponse | undefined {
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
      cache_hit: true,
    };
  } catch {
    return undefined;
  }
}

export class ModelGatewayService implements ModelgwHandler {
  readonly #unitPriceCache = new Map<string, { unitCostMinor: number; expireAt: number }>();
  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly modelProvider: ModelProvider,
    private readonly piiRedactionProvider: PIIRedactionProvider,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly cacheProvider: CacheProvider,
    private readonly queueProvider: QueueProvider,
    private readonly costEventsQueueName: string,
    private readonly costClient: CostHandlerClient,
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

    let result: Awaited<ReturnType<ModelProvider["invoke"]>>;
    try {
      result = await this.modelProvider.invoke({
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
    } catch (error) {
      await this.#recordModelOutcomeBestEffort(request, binding.model_id, "failure");
      throw error;
    }

    // Validation floor: the response must be well-formed JSON that decodes
    // to an object (not a bare string/number/array/null). This is a shape
    // check, not a content check -- it catches a provider adapter returning
    // garbage, not a "wrong answer" from the model itself.
    this.#validateOutputShape(result.outputJson);

    const usage = this.#parseUsage(result.usageJson);
    const totalTokens = usage.input_tokens + usage.output_tokens;
    
    const unitPriceMinor = await this.#resolveUnitPriceBestEffort(result.servedBy, "tokens");
    const estimatedCostUsd = (totalTokens * unitPriceMinor) / (100 * FALLBACK_USD_TO_INR_RATE);

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
    await this.#recordModelOutcomeBestEffort(request, result.servedBy, "success");

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
      cache_hit: false,
    };

    await this.#storeCacheBestEffort(request.tenant_id, embedding, response);

    return response;
  }

  async *stream(
    request: ModelgwStreamRequest,
  ): AsyncIterable<ModelgwStreamResponse> {
    const parsedAlias = ModelAliasSchema.safeParse(request.model_alias);
    if (!parsedAlias.success) {
      throw new InvalidModelAliasError(request.model_alias);
    }
    const alias = parsedAlias.data;
    const binding = await this.configProvider.resolveModelAlias(alias);
    const redacted = await this.piiRedactionProvider.redact({
      tenantId: request.tenant_id,
      text: request.input_json,
    });
    const limit = await this.configProvider.resolveCostLimit({
      tenantId: request.tenant_id,
      runId: request.run_id,
    });

    let expectedSequence = 1;
    let finalSeen = false;
    let servedBy: string | undefined;
    try {
      for await (const chunk of this.modelProvider.stream({
        tenantId: request.tenant_id,
        runId: request.run_id,
        nodeExecutionId: request.node_execution_id,
        modelId: binding.model_id,
        capabilityTags: binding.capability_tags,
        inputJson: redacted.redactedText,
        ...(binding.fallback_chain === undefined
          ? {}
          : { fallbackChain: binding.fallback_chain }),
      })) {
        if (finalSeen) {
          throw new ModelGatewayInvalidResponseError(
            "model stream emitted data after its final chunk",
          );
        }
        if (chunk.sequence !== expectedSequence) {
          throw new ModelGatewayInvalidResponseError(
            `model stream expected sequence ${expectedSequence}, received ${chunk.sequence}`,
          );
        }
        expectedSequence += 1;
        if (servedBy !== undefined && chunk.servedBy !== servedBy) {
          throw new ModelGatewayInvalidResponseError(
            "model stream changed providers after emission began",
          );
        }
        servedBy = chunk.servedBy;

        if (chunk.final) {
          finalSeen = true;
          const usage = this.#parseUsage(chunk.usageJson);
          const totalTokens = usage.input_tokens + usage.output_tokens;
          const unitPriceMinor = await this.#resolveUnitPriceBestEffort(chunk.servedBy, "tokens");
          const estimatedCostUsd = (totalTokens * unitPriceMinor) / (100 * FALLBACK_USD_TO_INR_RATE);

          await this.#emitCostEventBestEffort(
            request,
            chunk.servedBy,
            chunk.usageJson,
            estimatedCostUsd,
          );
          await this.#recordModelOutcomeBestEffort(request, chunk.servedBy, "success");
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
        }
        yield {
          sequence: chunk.sequence,
          delta: chunk.delta,
          final: chunk.final,
        };
      }
      if (!finalSeen) {
        throw new ModelGatewayInvalidResponseError(
          "model stream ended without a final usage chunk",
        );
      }
    } catch (error) {
      // A success outcome was already recorded above the moment the final
      // chunk arrived -- a later throw (e.g. a cost-limit rejection, or a
      // provider emitting data after its own final chunk) must not also
      // record a contradictory failure for the same real model call.
      if (!finalSeen) {
        await this.#recordModelOutcomeBestEffort(
          request,
          servedBy ?? binding.model_id,
          "failure",
        );
      }
      throw error;
    }
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

  // Real transport for the embeddingProvider that already exists internally
  // (used until now only for this service's own semantic-cache writes,
  // #embedBestEffort below) -- callers outside model-gateway (e.g. ads-core's
  // real chunk embedding, KNOW-5) previously had no way to reach it at all.
  // Unlike #embedBestEffort, this never swallows a failure: a caller asking
  // for an embedding needs to know if it didn't get one.
  async embed(request: ModelgwEmbedRequest): Promise<ModelgwEmbedResponse> {
    if (request.dimensions !== 512 && request.dimensions !== 1024) {
      throw new InvalidEmbeddingDimensionsError(request.dimensions);
    }
    const dimensions: EmbeddingDimensions = request.dimensions;
    const result = await this.embeddingProvider.embed({
      tenantId: request.tenant_id,
      text: request.text,
      dimensions,
    });
    return {
      embedding: [...result.vector],
      dimensions: result.dimensions,
      model_id: result.modelId,
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

  async #resolveUnitPriceBestEffort(provider: string, resource: string): Promise<number> {
    const cacheKey = `${provider}:${resource}`;
    const cached = this.#unitPriceCache.get(cacheKey);
    if (cached !== undefined && Date.now() < cached.expireAt) {
      return cached.unitCostMinor;
    }

    try {
      const response = await this.costClient.resolveUnitPrice({ provider, resource });
      const unitCostMinor = Number(response.unit_cost_minor);
      
      this.#unitPriceCache.set(cacheKey, {
        unitCostMinor,
        expireAt: Date.now() + COST_CACHE_TTL_MS,
      });
      return unitCostMinor;
    } catch (error) {
      // Fail open: log loudly and fallback to the constant
      console.error(`Failed to resolve unit price for ${provider}/${resource}, falling back to constant`, error);
      return Math.round(ESTIMATED_USD_PER_TOKEN * 100 * FALLBACK_USD_TO_INR_RATE);
    }
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
        source: "model_gateway",
        occurred_at: new Date().toISOString(),
      });
    } catch {
      // Cost-event emission is best-effort: an unreachable or throttled
      // queue must never block returning an otherwise-successful model
      // response to the caller. The Cost Ledger will simply be missing
      // this event -- acceptable, unlike blocking the whole gateway.
    }
  }

  async #recordModelOutcomeBestEffort(
    request: ModelgwInvokeRequest | ModelgwStreamRequest,
    provider: string,
    verdict: "success" | "failure",
  ): Promise<void> {
    try {
      await this.costClient.recordModelOutcome({
        tenant_id: request.tenant_id,
        provider,
        resource: "tokens",
        verdict,
        run_id: request.run_id,
        node_execution_id: request.node_execution_id,
        recorded_at: new Date().toISOString(),
      });
    } catch {
      // Best-effort, mirrors #emitCostEventBestEffort: an unreachable Cost
      // Ledger must never block returning an otherwise-successful model
      // response, nor mask the real error on a failure path.
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
