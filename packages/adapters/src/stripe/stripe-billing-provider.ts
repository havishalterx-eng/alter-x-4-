import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  BillingEvent,
  BillingDispute,
  BillingRefund,
  BillingPlan,
  BillingProvider,
  Invoice,
  Page,
  PaymentMethodRef,
  ProviderHealth,
  ProviderMetadata,
  Subscription,
} from "@alterx/shared-clients";

export const STRIPE_BILLING_FEATURE_FLAG = "billing.stripe.enabled";

const capabilities: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: [],
  data_residency: [],
  batch_support: false,
  maximum_payload: 65_536,
  supported_languages: [],
  cost_model: { rates: [] },
};

const metadata: ProviderMetadata<"BillingProvider"> = {
  providerId: "stripe",
  interfaceName: "BillingProvider",
  displayName: "Stripe",
  version: "not-activated",
  telemetryNamespace: "alterx.adapters.stripe.billing",
  featureFlag: STRIPE_BILLING_FEATURE_FLAG,
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "stripe-billing-v1",
    rollbackSupported: true,
  },
};

export class StripeBillingNotActivatedError extends Error {
  constructor() {
    super("Stripe billing provider is not activated");
    this.name = "StripeBillingNotActivatedError";
  }
}

export class StripeBillingProvider implements BillingProvider {
  readonly metadata = metadata;
  readonly capabilities = capabilities;

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "degraded",
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      details: { activated: false },
    };
  }

  listPlans(): Promise<BillingPlan[]> {
    return inactive();
  }
  getSubscription(): Promise<Subscription | null> {
    return inactive();
  }
  createSubscription(): Promise<Subscription> {
    return inactive();
  }
  changeSubscription(): Promise<Subscription> {
    return inactive();
  }
  cancelSubscription(): Promise<Subscription> {
    return inactive();
  }
  listInvoices(): Promise<Page<Invoice>> {
    return inactive();
  }
  attachPaymentMethod(): Promise<PaymentMethodRef> {
    return inactive();
  }
  listPaymentMethods(): Promise<PaymentMethodRef[]> {
    return inactive();
  }
  detachPaymentMethod(): Promise<void> {
    return inactive();
  }
  refundPayment(): Promise<BillingRefund> {
    return inactive();
  }
  resolveDispute(): Promise<BillingDispute> {
    return inactive();
  }
  verifyWebhookSignature(): boolean {
    throw new StripeBillingNotActivatedError();
  }
  parseWebhookEvent(): BillingEvent {
    throw new StripeBillingNotActivatedError();
  }
}

function inactive<T>(): Promise<T> {
  return Promise.reject(new StripeBillingNotActivatedError());
}
