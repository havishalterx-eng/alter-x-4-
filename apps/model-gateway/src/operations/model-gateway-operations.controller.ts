import { createHash, timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import {
  ModelAliasPathSchema,
  UpdateModelAliasRequestSchema,
  UpdateProviderControlRequestSchema,
  type ProviderControl,
} from "@alterx/contracts";
import { FailoverModelProvider } from "@alterx/adapters";
import { OperationalConfigProvider } from "./operational-config-provider";

export const MODEL_GATEWAY_ADMIN_TOKEN = Symbol("MODEL_GATEWAY_ADMIN_TOKEN");

@Controller("internal/admin")
export class ModelGatewayOperationsController {
  private readonly tokenHash: Buffer;

  constructor(
    private readonly providers: FailoverModelProvider,
    private readonly policy: OperationalConfigProvider,
    @Inject(MODEL_GATEWAY_ADMIN_TOKEN)
    serviceToken: string,
  ) {
    this.tokenHash = digest(serviceToken);
  }

  @Get("providers")
  async listProviders(@Headers("authorization") authorization?: string): Promise<ProviderControl[]> {
    this.authorize(authorization);
    return (await this.providers.getProviderControls()).map((control) => ({
      provider_id: control.providerId,
      interface_name: "ModelProvider",
      health: control.health,
      checked_at: control.checkedAt,
      latency_ms: control.latencyMs,
      active: control.active,
      configuration_revision: control.configurationRevision,
      fallback_chain: [...control.fallbackChain],
    }));
  }

  @Patch("providers/:providerId")
  async updateProvider(
    @Param("providerId") providerId: string,
    @Body() rawBody: unknown,
    @Headers("authorization") authorization?: string,
  ): Promise<ProviderControl> {
    this.authorize(authorization);
    const body = parse(UpdateProviderControlRequestSchema, rawBody);
    const control = await this.providers.updateProviderControl(providerId, {
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.fallback_chain === undefined
        ? {}
        : { fallbackChain: body.fallback_chain }),
    });
    return {
      provider_id: control.providerId,
      interface_name: "ModelProvider",
      health: control.health,
      checked_at: control.checkedAt,
      latency_ms: control.latencyMs,
      active: control.active,
      configuration_revision: control.configurationRevision,
      fallback_chain: [...control.fallbackChain],
    };
  }

  @Get("model-policy")
  getModelPolicy(@Headers("authorization") authorization?: string) {
    this.authorize(authorization);
    return this.policy.getModelPolicy(true);
  }

  @Put("model-policy/:alias")
  updateModelPolicy(
    @Param("alias") rawAlias: string,
    @Body() rawBody: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    this.authorize(authorization);
    const alias = parse(ModelAliasPathSchema, rawAlias);
    const body = parse(UpdateModelAliasRequestSchema, rawBody);
    return this.policy.proposeModelAlias(alias, body.binding);
  }

  @Put("model-policy/:alias/proposal")
  proposeModelPolicy(
    @Param("alias") rawAlias: string,
    @Body() rawBody: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    this.authorize(authorization);
    const alias = parse(ModelAliasPathSchema, rawAlias);
    const body = parse(UpdateModelAliasRequestSchema, rawBody);
    return this.policy.proposeModelAlias(alias, body.binding);
  }

  @Post("model-policy/promote")
  promoteModelPolicy(@Headers("authorization") authorization?: string) {
    this.authorize(authorization);
    return this.policy.promoteModelAlias();
  }

  private authorize(authorization: string | undefined): void {
    const prefix = "Bearer ";
    const candidate = authorization?.startsWith(prefix)
      ? authorization.slice(prefix.length)
      : "";
    const candidateHash = digest(candidate);
    if (!timingSafeEqual(this.tokenHash, candidateHash)) {
      throw new HttpException("Unauthorized", 401);
    }
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function parse<T>(schema: SafeParser<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpException("Invalid administration request", 400);
}

interface SafeParser<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false };
}
