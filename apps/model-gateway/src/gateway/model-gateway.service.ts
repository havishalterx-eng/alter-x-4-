import {
  ModelAliasSchema,
  type ModelgwInvokeRequest,
  type ModelgwInvokeResponse,
} from "@alterx/contracts";
import type { ModelgwHandler } from "@alterx/adapters";
import {
  InvalidModelAliasError,
  type ConfigProvider,
  type ModelProvider,
} from "@alterx/shared-clients";

export class ModelGatewayService implements ModelgwHandler {
  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly modelProvider: ModelProvider,
  ) {}

  async invoke(request: ModelgwInvokeRequest): Promise<ModelgwInvokeResponse> {
    const parsedAlias = ModelAliasSchema.safeParse(request.model_alias);
    if (!parsedAlias.success) {
      throw new InvalidModelAliasError(request.model_alias);
    }
    const alias = parsedAlias.data;

    const binding = await this.configProvider.resolveModelAlias(alias);
    const result = await this.modelProvider.invoke({
      tenantId: request.tenant_id,
      runId: request.run_id,
      nodeExecutionId: request.node_execution_id,
      modelId: binding.model_id,
      capabilityTags: binding.capability_tags,
      inputJson: request.input_json,
    });

    return {
      output_json: result.outputJson,
      usage_json: result.usageJson,
      // Echoes the alias tier actually resolved and served for this
      // invocation. GATE-3 will divert this to the fallback tier's alias
      // when the primary provider fails over, so callers can always see
      // which capability class was really used -- never a silent downgrade.
      resolved_capability: alias,
    };
  }
}
