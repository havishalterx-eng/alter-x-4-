import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import type {
  BillingPlan,
  Invoice,
  Page,
  PaymentMethodRef,
} from "@alterx/shared-clients";
import { EtagConstrained, EtagResponseInterceptor } from "../concurrency";
import { Idempotent } from "../idempotency";
import {
  ActorContext,
  RequirePermission,
  RequireTenantRole,
  type ActorContextType,
} from "../rbac";
import { BillingExceptionFilter } from "./billing-exception.filter";
import { BillingService } from "./billing.service";
import type { BillingSubscriptionView } from "./types";
import {
  parseAttachPaymentMethod,
  parseChangeSubscription,
  parseCreateSubscription,
  parseInvoicesQuery,
  parsePaymentMethodRef,
} from "./validation";

@Controller("/api/v1/billing")
@UseFilters(BillingExceptionFilter)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("plans")
  @RequireTenantRole("admin")
  @RequirePermission("billing:read")
  plans(): Promise<BillingPlan[]> {
    return this.billing.listPlans();
  }

  @Get("subscription")
  @RequireTenantRole("admin")
  @RequirePermission("billing:read")
  @UseInterceptors(EtagResponseInterceptor)
  subscription(
    @ActorContext() actor: ActorContextType,
  ): Promise<BillingSubscriptionView | null> {
    return this.billing.getSubscription(actor.tenant_id);
  }

  @Post("subscription")
  @HttpCode(201)
  @RequireTenantRole("owner")
  @RequirePermission("billing:write")
  @Idempotent()
  createSubscription(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ): Promise<BillingSubscriptionView> {
    return this.billing.createSubscription(
      actor.tenant_id,
      parseCreateSubscription(body, "/api/v1/billing/subscription"),
    );
  }

  @Patch("subscription")
  @RequireTenantRole("owner")
  @RequirePermission("billing:write")
  @EtagConstrained()
  @Idempotent()
  changeSubscription(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ): Promise<BillingSubscriptionView> {
    return this.billing.changeSubscription(
      actor.tenant_id,
      parseChangeSubscription(body, "/api/v1/billing/subscription"),
    );
  }

  @Delete("subscription")
  @RequireTenantRole("owner")
  @RequirePermission("billing:write")
  @Idempotent()
  cancelSubscription(
    @ActorContext() actor: ActorContextType,
  ): Promise<BillingSubscriptionView> {
    return this.billing.cancelSubscription(actor.tenant_id);
  }

  @Get("invoices")
  @RequireTenantRole("admin")
  @RequirePermission("billing:read")
  invoices(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType,
  ): Promise<Page<Invoice>> {
    const query = parseInvoicesQuery(
      cursor,
      limit,
      "/api/v1/billing/invoices",
    );
    return this.billing.listInvoices(
      actor.tenant_id,
      query.cursor,
      query.limit,
    );
  }

  @Get("payment-methods")
  @RequireTenantRole("admin")
  @RequirePermission("billing:read")
  paymentMethods(
    @ActorContext() actor: ActorContextType,
  ): Promise<PaymentMethodRef[]> {
    return this.billing.listPaymentMethods(actor.tenant_id);
  }

  @Post("payment-methods")
  @HttpCode(201)
  @RequireTenantRole("owner")
  @RequirePermission("billing:write")
  @Idempotent()
  attachPaymentMethod(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ): Promise<PaymentMethodRef> {
    return this.billing.attachPaymentMethod(
      actor.tenant_id,
      parseAttachPaymentMethod(body, "/api/v1/billing/payment-methods"),
    );
  }

  @Delete("payment-methods/:ref")
  @HttpCode(204)
  @RequireTenantRole("owner")
  @RequirePermission("billing:write")
  @Idempotent()
  detachPaymentMethod(
    @Param("ref") ref: string,
    @ActorContext() actor: ActorContextType,
  ): Promise<void> {
    const instance =
      `/api/v1/billing/payment-methods/${encodeURIComponent(ref)}`;
    return this.billing.detachPaymentMethod(
      actor.tenant_id,
      parsePaymentMethodRef(ref, instance),
    );
  }
}
