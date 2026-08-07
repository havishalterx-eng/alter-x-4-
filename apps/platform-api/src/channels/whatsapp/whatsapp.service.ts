import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MetaCloudApiWhatsappProvider } from "@alterx/adapters";
import type { JsonValue, SecretsProvider } from "@alterx/shared-clients";
import { EngineClient, type EngineCallerContext } from "../../engine";
import { secretsProviderToken } from "../../identity-broker/identity-broker.module";

export interface WhatsappAccount {
  readonly id: string;
  readonly workspaceId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly accessTokenRef: string;
  readonly status: "connected" | "disconnected";
  readonly monitoringConfig?: Readonly<Record<string, unknown>>;
  readonly mediaConfig?: Readonly<Record<string, unknown>>;
  readonly escalationRules?: readonly Readonly<Record<string, unknown>>[];
}

export interface CreateWhatsappAccountInput {
  readonly workspaceId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly accessTokenRef: string;
}

@Injectable()
export class WhatsappService {
  private readonly provider: MetaCloudApiWhatsappProvider;

  constructor(
    private readonly engine: EngineClient,
    @Inject(secretsProviderToken) secrets: SecretsProvider,
  ) {
    this.provider = new MetaCloudApiWhatsappProvider(secrets);
  }

  async register(
    input: CreateWhatsappAccountInput,
    context: EngineCallerContext,
    idempotencyKey: string,
  ): Promise<WhatsappAccount> {
    const response = await this.engine.post<JsonValue, WhatsappAccount>(
      "/api/v1/channels/whatsapp/accounts",
      input as unknown as JsonValue,
      context,
      { idempotencyKey },
    );
    if (!response.body) throw new Error("Engine returned an empty WhatsApp account response");
    return response.body;
  }

  async list(context: EngineCallerContext): Promise<readonly WhatsappAccount[]> {
    const response = await this.engine.get<{ readonly accounts: readonly WhatsappAccount[] }>(
      "/api/v1/channels/whatsapp/accounts",
      context,
    );
    return response.body?.accounts ?? [];
  }

  async templates(accountId: string, context: EngineCallerContext) {
    return this.provider.getTemplates(await this.account(accountId, context));
  }

  async testSend(
    accountId: string,
    to: string,
    templateName: string,
    languageCode: string | undefined,
    context: EngineCallerContext,
  ) {
    return this.provider.sendTemplateMessage(
      await this.account(accountId, context), to, templateName, languageCode,
    );
  }

  async health(accountId: string, context: EngineCallerContext) {
    return this.provider.getAccountHealth(await this.account(accountId, context));
  }

  async updateConfiguration(
    accountId: string,
    configuration: Readonly<Record<string, unknown>>,
    context: EngineCallerContext,
    idempotencyKey: string,
  ): Promise<WhatsappAccount> {
    await this.account(accountId, context);
    const response = await this.engine.post<JsonValue, WhatsappAccount>(
      `/api/v1/channels/whatsapp/accounts/${encodeURIComponent(accountId)}/configuration`,
      configuration as JsonValue,
      context,
      { idempotencyKey },
    );
    if (!response.body) throw new Error("Engine returned an empty WhatsApp account response");
    return response.body;
  }

  private async account(accountId: string, context: EngineCallerContext): Promise<WhatsappAccount> {
    const account = (await this.list(context)).find((item) => item.id === accountId);
    if (!account) throw new NotFoundException("WhatsApp account not found");
    return account;
  }
}
