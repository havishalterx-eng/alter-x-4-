import {
  ModelAliasSchema,
  type ModelgwInvokeRequest,
  type ModelgwInvokeResponse,
  type ModelgwRedactRequest,
  type ModelgwRedactResponse,
} from "@alterx/contracts";
import type { ModelgwHandler } from "@alterx/adapters";
import {
  InvalidModelAliasError,
  type CacheProvider,
  type ConfigProvider,
  type EmbeddingProvider,
  type ModelProvider,
  type PIIRedactionProvider,
} from "@alterx/shared-clients";

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
