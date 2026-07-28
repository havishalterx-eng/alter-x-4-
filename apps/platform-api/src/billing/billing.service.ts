import { Inject, Injectable } from "@nestjs/common";
import type {
  BillingPlan,
  BillingProvider,
  Invoice,
  Page,
  PaymentMethodRef,
  Subscription,
} from "@alterx/shared-clients";
import { BillingRepository } from "./billing.repository";
import { BillingHttpError } from "./problem";
import { BILLING_PROVIDER } from "./tokens";
import type {
  AttachPaymentMethodInput,
  BillingSubscriptionView,
  ChangeSubscriptionInput,
  CreateSubscriptionInput,
} from "./types";

@Injectable()
export class BillingService {
  constructor(
    private readonly repository: BillingRepository,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProvider,
  ) {}

  listPlans(): Promise<BillingPlan[]> {
    return this.provided("/api/v1/billing/plans", () =>
      this.provider.listPlans(),
    );
  }

  async getSubscription(
    tenantId: string,
  ): Promise<BillingSubscriptionView | null> {
    const instance = "/api/v1/billing/subscription";
    const subscription = await this.provided(instance, () =>
      this.provider.getSubscription(tenantId),
    );
    if (!subscription) return null;
    const profile = await this.repository.getProfile(tenantId);
    if (!profile) {
      throw new BillingHttpError(
        502,
        "BILLING_PROFILE_INCONSISTENT",
        "Billing profile is inconsistent",
        instance,
      );
    }
    return view(subscription, profile.updatedAt);
  }

  async createSubscription(
    tenantId: string,
    input: CreateSubscriptionInput,
  ): Promise<BillingSubscriptionView> {
    const instance = "/api/v1/billing/subscription";
    const subscription = await this.provided(instance, () =>
      this.provider.createSubscription(
        tenantId,
        input.plan_id,
        input.payment_method_ref,
      ),
    );
    const profile = await this.repository.syncSubscription(
      tenantId,
      subscription,
    );
    return view(subscription, profile.updatedAt);
  }

  async changeSubscription(
    tenantId: string,
    input: ChangeSubscriptionInput,
  ): Promise<BillingSubscriptionView> {
    const instance = "/api/v1/billing/subscription";
    const subscription = await this.provided(instance, () =>
      this.provider.changeSubscription(tenantId, input.plan_id),
    );
    const profile = await this.repository.syncSubscription(
      tenantId,
      subscription,
    );
    return view(subscription, profile.updatedAt);
  }

  async cancelSubscription(
    tenantId: string,
  ): Promise<BillingSubscriptionView> {
    const instance = "/api/v1/billing/subscription";
    const subscription = await this.provided(instance, () =>
      this.provider.cancelSubscription(tenantId),
    );
    const profile = await this.repository.syncSubscription(
      tenantId,
      subscription,
    );
    return view(subscription, profile.updatedAt);
  }

  listInvoices(
    tenantId: string,
    cursor?: string,
    limit?: number,
  ): Promise<Page<Invoice>> {
    return this.provided("/api/v1/billing/invoices", () =>
      this.provider.listInvoices(tenantId, cursor, limit),
    );
  }

  attachPaymentMethod(
    tenantId: string,
    input: AttachPaymentMethodInput,
  ): Promise<PaymentMethodRef> {
    return this.provided("/api/v1/billing/payment-methods", () =>
      this.provider.attachPaymentMethod(tenantId, input.provider_token),
    );
  }

  listPaymentMethods(tenantId: string): Promise<PaymentMethodRef[]> {
    return this.provided("/api/v1/billing/payment-methods", () =>
      this.provider.listPaymentMethods(tenantId),
    );
  }

  detachPaymentMethod(tenantId: string, ref: string): Promise<void> {
    return this.provided(
      `/api/v1/billing/payment-methods/${encodeURIComponent(ref)}`,
      () => this.provider.detachPaymentMethod(tenantId, ref),
    );
  }

  private async provided<T>(
    instance: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new BillingHttpError(
        502,
        "BILLING_PROVIDER_ERROR",
        "Billing provider operation failed",
        instance,
      );
    }
  }
}

function view(
  subscription: Subscription,
  updatedAt: Date,
): BillingSubscriptionView {
  return { ...subscription, version: updatedAt.toISOString() };
}
