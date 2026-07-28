import type {
  PaymentMethodRef,
  Subscription,
} from "@alterx/shared-clients";

export interface BillingProfileRecord {
  tenantId: string;
  id: string;
  providerId: string;
  providerCustomerRef: string | null;
  subscriptionRef: string | null;
  status: string;
  currentPlan: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingSubscriptionView extends Subscription {
  readonly version: string;
}

export interface CreateSubscriptionInput {
  plan_id: string;
  payment_method_ref: string;
}

export interface ChangeSubscriptionInput {
  plan_id: string;
}

export interface AttachPaymentMethodInput {
  provider_token: string;
}

export const billingDeferredCapabilities = [
  {
    capability: "overage_billing",
    status: "NOT_MET",
    reason: "Cost Ledger OUT-4 metered usage does not exist.",
  },
  {
    capability: "invoice_cost_ledger_reconciliation",
    status: "NOT_MET",
    reason: "Cost Ledger OUT-4 does not exist.",
  },
] as const;

export type BillingPaymentMethodView = PaymentMethodRef;
