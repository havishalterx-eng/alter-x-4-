import { Injectable, Logger } from "@nestjs/common";
import type {
  FeatureFlag,
  ModelAlias,
  ModelAliasPolicy,
  ProviderControl,
  UpdateModelAliasRequest,
  UpdateProviderControlRequest,
  UpsertFeatureFlagRequest,
} from "@alterx/contracts";
import { AdminAuditService } from "../admin-audit";
import { FeatureFlagRepository } from "./feature-flag.repository";
import {
  ModelGatewayAdminClient,
  ModelGatewayAdminClientError,
} from "./model-gateway-admin.client";
import { AdminControlsHttpError } from "./problem";

@Injectable()
export class AdminControlsService {
  private readonly logger = new Logger(AdminControlsService.name);

  constructor(
    private readonly gateway: ModelGatewayAdminClient,
    private readonly flags: FeatureFlagRepository,
    private readonly audit: AdminAuditService,
  ) {}

  listProviders(): Promise<ProviderControl[]> {
    return this.gatewayCall("/api/v1/admin/providers", () => this.gateway.listProviders());
  }

  async updateProvider(
    providerId: string,
    staffUserId: string,
    input: UpdateProviderControlRequest,
  ): Promise<ProviderControl> {
    const result = await this.gatewayCall(
      `/api/v1/admin/providers/${providerId}`,
      () => this.gateway.updateProvider(providerId, input),
    );
    await this.audit.record({
      actorType: "admin",
      actorRef: staffUserId,
      action: "provider.control.update",
      targetType: "provider",
      targetRef: providerId,
      reasonCode: "staff_decision",
      scope: "providers:write",
    });
    return result;
  }

  listFeatureFlags(): Promise<FeatureFlag[]> {
    return this.flags.list();
  }

  async upsertFeatureFlag(
    name: string,
    staffUserId: string,
    input: UpsertFeatureFlagRequest,
  ): Promise<FeatureFlag> {
    const result = await this.flags.upsert(
      name,
      input.enabled,
      input.description,
      staffUserId,
    );
    await this.audit.record({
      actorType: "admin",
      actorRef: staffUserId,
      action: "policy.feature_flag.upsert",
      targetType: "feature_flag",
      targetRef: name,
      reasonCode: "staff_decision",
      scope: "policy:feature-flags:write",
    });
    return result;
  }

  getModelPolicy(): Promise<ModelAliasPolicy> {
    return this.gatewayCall(
      "/api/v1/admin/policy/model",
      () => this.gateway.getModelPolicy(),
    );
  }

  async updateModelAlias(
    alias: ModelAlias,
    staffUserId: string,
    input: UpdateModelAliasRequest,
  ): Promise<ModelAliasPolicy> {
    return this.proposeModelAlias(alias, staffUserId, input);
  }

  async proposeModelAlias(
    alias: ModelAlias,
    staffUserId: string,
    input: UpdateModelAliasRequest,
  ): Promise<ModelAliasPolicy> {
    const result = await this.gatewayCall(
      `/api/v1/admin/policy/model/${alias}/proposal`,
      () => this.gateway.proposeModelAlias(alias, input.binding, input.reason),
    );
    await this.audit.record({
      actorType: "admin",
      actorRef: staffUserId,
      action: "policy.model_alias.propose",
      targetType: "model_alias",
      targetRef: alias,
      reasonCode: "staff_decision",
      scope: "policy:model:write",
    });
    return result;
  }

  async promoteModelAlias(staffUserId: string): Promise<ModelAliasPolicy> {
    const result = await this.gatewayCall(
      "/api/v1/admin/policy/model/promote",
      () => this.gateway.promoteModelAlias(),
    );
    await this.audit.record({
      actorType: "admin",
      actorRef: staffUserId,
      action: "policy.model_alias.promote",
      targetType: "model_policy",
      targetRef: "pending",
      reasonCode: "staff_decision",
      scope: "policy:model:write",
    });
    return result;
  }

  private async gatewayCall<T>(instance: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof ModelGatewayAdminClientError)) throw error;
      this.logger.error(error.message);
      throw new AdminControlsHttpError(
        502,
        "MODEL_GATEWAY_ADMIN_UNAVAILABLE",
        "Model gateway administration is unavailable",
        instance,
      );
    }
  }
}
