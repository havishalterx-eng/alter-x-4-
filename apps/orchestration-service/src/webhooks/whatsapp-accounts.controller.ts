import { Body, Controller, Get, HttpException, Param, Post, Req } from "@nestjs/common";
import type { SessionGatewayRequest } from "@alterx/auth";
import type { WhatsappAccount } from "./whatsapp-account-registry.service";
import { WhatsappAccountRegistryService } from "./whatsapp-account-registry.service";

interface RegisterAccountBody {
  readonly workspaceId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly accessTokenRef: string;
  readonly status?: "connected" | "disconnected";
  readonly monitoringConfig?: Readonly<Record<string, unknown>>;
  readonly mediaConfig?: Readonly<Record<string, unknown>>;
  readonly escalationRules?: readonly Readonly<Record<string, unknown>>[];
}

@Controller("api/v1/channels/whatsapp/accounts")
export class WhatsappAccountsController {
  constructor(private readonly registry: WhatsappAccountRegistryService) {}

  @Post()
  async register(@Req() request: SessionGatewayRequest, @Body() body: RegisterAccountBody): Promise<WhatsappAccount> {
    const tenantId = requiredTenantId(request);
    if (!body.workspaceId || !body.phoneNumberId || !body.wabaId || !body.accessTokenRef) {
      throw new HttpException("workspaceId, phoneNumberId, wabaId, and accessTokenRef are required", 400);
    }
    return this.registry.register(tenantId, {
      workspaceId: body.workspaceId,
      phoneNumberId: body.phoneNumberId,
      wabaId: body.wabaId,
      accessTokenRef: body.accessTokenRef,
      status: body.status ?? "connected",
      monitoringConfig: body.monitoringConfig ?? {},
      mediaConfig: body.mediaConfig ?? {},
      escalationRules: body.escalationRules ?? [],
    });
  }

  @Get()
  async list(@Req() request: SessionGatewayRequest): Promise<{ readonly accounts: readonly WhatsappAccount[] }> {
    return { accounts: await this.registry.list(requiredTenantId(request)) };
  }

  @Post(":id/configuration")
  async updateConfiguration(
    @Req() request: SessionGatewayRequest,
    @Param("id") accountId: string,
    @Body() body: {
      readonly monitoringConfig?: Readonly<Record<string, unknown>>;
      readonly mediaConfig?: Readonly<Record<string, unknown>>;
      readonly escalationRules?: readonly Readonly<Record<string, unknown>>[];
    },
  ): Promise<WhatsappAccount> {
    return this.registry.updateConfiguration(requiredTenantId(request), accountId, body);
  }
}

function requiredTenantId(request: SessionGatewayRequest): string {
  const tenantId = request.actorContext?.tenant_id;
  if (!tenantId) throw new HttpException("Missing authenticated tenant context", 500);
  return tenantId;
}
