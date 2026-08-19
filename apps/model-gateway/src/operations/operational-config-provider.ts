import { randomUUID } from "node:crypto";
import {
  ModelAliasPolicySchema,
  type ModelAlias,
  type ModelAliasBinding,
  type ModelAliasPolicy,
} from "@alterx/contracts";
import type {
  ConfigProvider,
  CostLimitBinding,
  CostLimitRequest,
  MutableParameterStoreProvider,
  ProviderHealth,
  ToolPermissionBinding,
  ToolPermissionRequest,
} from "@alterx/shared-clients";

const aliases = ["FAST", "STANDARD", "ADVANCED", "CEILING"] as const;

export class OperationalConfigProvider implements ConfigProvider {
  readonly metadata;
  readonly capabilities;
  private policy: ModelAliasPolicy | undefined;

  constructor(
    private readonly baseline: ConfigProvider,
    private readonly store: MutableParameterStoreProvider | undefined,
    private readonly parameterName: string,
  ) {
    this.metadata = baseline.metadata;
    this.capabilities = baseline.capabilities;
  }

  healthCheck(): Promise<ProviderHealth> {
    return this.baseline.healthCheck();
  }

  async resolveModelAlias(alias: ModelAlias): Promise<ModelAliasBinding> {
    // Refresh each resolution so overrides written by another replica take effect.
    await this.loadOverride(true);
    return this.policy?.bindings[alias] ?? this.baseline.resolveModelAlias(alias);
  }

  resolveToolPermission(request: ToolPermissionRequest): Promise<ToolPermissionBinding> {
    return this.baseline.resolveToolPermission(request);
  }

  resolveCostLimit(request: CostLimitRequest): Promise<CostLimitBinding> {
    return this.baseline.resolveCostLimit(request);
  }

  async getModelPolicy(refresh = true): Promise<ModelAliasPolicy> {
    await this.loadOverride(refresh);
    if (this.policy) return structuredClone(this.policy);
    const bindings = await Promise.all(
      aliases.map((alias) => this.baseline.resolveModelAlias(alias)),
    );
    return {
      version: "baseline-live",
      bindings: {
        FAST: bindings[0]!,
        STANDARD: bindings[1]!,
        ADVANCED: bindings[2]!,
        CEILING: bindings[3]!,
      },
    };
  }

  async updateModelAlias(
    alias: ModelAlias,
    binding: ModelAliasBinding,
  ): Promise<ModelAliasPolicy> {
    return this.proposeModelAlias(alias, binding);
  }

  async proposeModelAlias(
    alias: ModelAlias,
    binding: ModelAliasBinding,
  ): Promise<ModelAliasPolicy> {
    if (!this.store) {
      throw new ModelPolicyPersistenceError(
        "Mutable model policy store is not configured",
      );
    }
    const current = await this.getModelPolicy(true);
    const next = ModelAliasPolicySchema.parse({
      ...current,
      version: randomUUID(),
      bindings: { ...current.bindings, [alias]: binding },
    });
    await this.store.putParameter(this.pendingParameterName, JSON.stringify(next));
    return structuredClone(next);
  }

  async promoteModelAlias(): Promise<ModelAliasPolicy> {
    if (!this.store) {
      throw new ModelPolicyPersistenceError(
        "Mutable model policy store is not configured",
      );
    }
    const pending = await this.readPolicy(this.pendingParameterName);
    if (!pending) throw new ModelPolicyPendingNotFoundError();
    await this.store.putParameter(this.parameterName, JSON.stringify(pending));
    await this.store.deleteParameter(this.pendingParameterName);
    this.policy = pending;
    return structuredClone(pending);
  }

  private get pendingParameterName(): string {
    return `${this.parameterName}/pending`;
  }

  private async loadOverride(refresh: boolean): Promise<void> {
    if (!this.store || (!refresh && this.policy)) return;
    const policy = await this.readPolicy(this.parameterName);
    this.policy = policy;
  }

  private async readPolicy(parameterName: string): Promise<ModelAliasPolicy | undefined> {
    if (!this.store) return undefined;
    try {
      const raw = await this.store.getParameter(parameterName);
      return ModelAliasPolicySchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingParameter(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

function isMissingParameter(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "ParameterNotFound" || /not found/i.test(error.message));
}

export class ModelPolicyPersistenceError extends Error {}

export class ModelPolicyPendingNotFoundError extends Error {
  constructor() {
    super("No pending model policy proposal exists");
    this.name = "ModelPolicyPendingNotFoundError";
  }
}
