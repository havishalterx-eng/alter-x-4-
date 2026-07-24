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
  type ConfigProvider,
  type ModelProvider,
  type PIIRedactionProvider,
} from "@alterx/shared-clients";

export class ModelGatewayService implements ModelgwHandler {
  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly modelProvider: ModelProvider,
    private readonly piiRedactionProvider: PIIRedactionProvider,
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
    // the standalone Redact RPC on the content itself.
    const redacted = await this.piiRedactionProvider.redact({
      tenantId: request.tenant_id,
      text: request.input_json,
    });
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

    return {
      output_json: result.outputJson,
      usage_json: result.usageJson,
      // Always names both the alias tier resolved AND the concrete
      // provider that actually served it, e.g. "STANDARD:aws-bedrock" on
      // the normal path or "STANDARD:anthropic-direct" when GATE-3's
      // failover chain kicked in -- never a silent downgrade.
      resolved_capability: `${alias}:${result.servedBy}`,
    };
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
}
