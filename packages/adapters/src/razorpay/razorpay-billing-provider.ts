import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  BillingEvent,
  BillingPlan,
  BillingProvider,
  Invoice,
  Page,
  PaymentMethodRef,
  ProviderHealth,
  ProviderMetadata,
  SecretsProvider,
  Subscription,
} from "@alterx/shared-clients";

export interface BillingTenantReferences {
  readonly providerCustomerRef: string | null;
  readonly subscriptionRef: string | null;
}

export interface BillingReferenceStore {
  getTenantReferences(tenantId: string): Promise<BillingTenantReferences | null>;
  setSubscriptionReferences(
    tenantId: string,
    references: BillingTenantReferences,
  ): Promise<void>;
  savePaymentMethod(
    tenantId: string,
    method: PaymentMethodRef,
  ): Promise<void>;
  listPaymentMethods(tenantId: string): Promise<PaymentMethodRef[]>;
  deletePaymentMethod(tenantId: string, ref: string): Promise<void>;
}

export interface RazorpayHttpRequest {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly authorization: string;
  readonly body?: Readonly<Record<string, unknown>>;
}

export interface RazorpayHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface RazorpayHttpClient {
  request(request: RazorpayHttpRequest): Promise<RazorpayHttpResponse>;
}

export interface RazorpayBillingProviderConfig {
  readonly keyIdSecretRef: string;
  readonly keySecretSecretRef: string;
  readonly totalBillingCycles?: number;
}

export const RAZORPAY_BILLING_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["IN"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 65_536,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const metadata: ProviderMetadata<"BillingProvider"> = {
  providerId: "razorpay",
  interfaceName: "BillingProvider",
  displayName: "Razorpay",
  version: "1.0.0",
  telemetryNamespace: "alterx.adapters.razorpay.billing",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "razorpay-billing-v1",
    rollbackSupported: true,
  },
};

export class RazorpayBillingProvider implements BillingProvider {
  readonly metadata = metadata;
  readonly capabilities = RAZORPAY_BILLING_CAPABILITIES;

  constructor(
    private readonly config: RazorpayBillingProviderConfig,
    private readonly secrets: SecretsProvider,
    private readonly references: BillingReferenceStore,
    private readonly http: RazorpayHttpClient =
      createFetchRazorpayHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async healthCheck(): Promise<ProviderHealth> {
    const started = this.now().getTime();
    try {
      await this.call("GET", "/v1/plans?count=1");
      const checkedAt = this.now();
      return {
        status: "healthy",
        checkedAt: checkedAt.toISOString(),
        latencyMs: checkedAt.getTime() - started,
      };
    } catch {
      const checkedAt = this.now();
      return {
        status: "unhealthy",
        checkedAt: checkedAt.toISOString(),
        latencyMs: checkedAt.getTime() - started,
      };
    }
  }

  async listPlans(): Promise<BillingPlan[]> {
    const body = collection(await this.call("GET", "/v1/plans?count=100"));
    return body.items.map(mapPlan);
  }

  async getSubscription(tenantId: string): Promise<Subscription | null> {
    const refs = await this.references.getTenantReferences(tenantId);
    if (!refs?.subscriptionRef) return null;
    return mapSubscription(
      await this.call(
        "GET",
        `/v1/subscriptions/${encodeURIComponent(refs.subscriptionRef)}`,
      ),
      tenantId,
    );
  }

  async createSubscription(
    tenantId: string,
    planId: string,
    paymentMethodRef: string,
  ): Promise<Subscription> {
    const body = await this.call("POST", "/v1/subscriptions", {
      plan_id: planId,
      total_count: this.config.totalBillingCycles ?? 1_200,
      quantity: 1,
      customer_notify: true,
      notes: {
        tenant_id: tenantId,
        payment_method_ref: paymentMethodRef,
      },
    });
    const subscription = mapSubscription(body, tenantId);
    await this.references.setSubscriptionReferences(tenantId, {
      providerCustomerRef: subscription.providerCustomerRef,
      subscriptionRef: subscription.id,
    });
    return subscription;
  }

  async changeSubscription(
    tenantId: string,
    planId: string,
  ): Promise<Subscription> {
    const subscriptionRef = await this.requireSubscriptionRef(tenantId);
    return mapSubscription(
      await this.call(
        "PATCH",
        `/v1/subscriptions/${encodeURIComponent(subscriptionRef)}`,
        { plan_id: planId, schedule_change_at: "now" },
      ),
      tenantId,
    );
  }

  async cancelSubscription(tenantId: string): Promise<Subscription> {
    const subscriptionRef = await this.requireSubscriptionRef(tenantId);
    return mapSubscription(
      await this.call(
        "POST",
        `/v1/subscriptions/${encodeURIComponent(subscriptionRef)}/cancel`,
        { cancel_at_cycle_end: false },
      ),
      tenantId,
    );
  }

  async listInvoices(
    tenantId: string,
    cursor = "0",
    limit = 50,
  ): Promise<Page<Invoice>> {
    const subscriptionRef = await this.requireSubscriptionRef(tenantId);
    const skip = parseCursor(cursor);
    const body = collection(
      await this.call(
        "GET",
        `/v1/invoices?subscription_id=${encodeURIComponent(subscriptionRef)}` +
          `&count=${limit}&skip=${skip}`,
      ),
    );
    return {
      items: body.items.map(mapInvoice),
      nextCursor: body.items.length < limit ? null : String(skip + limit),
    };
  }

  async attachPaymentMethod(
    tenantId: string,
    providerToken: string,
  ): Promise<PaymentMethodRef> {
    const token = object(
      await this.call("POST", "/v1/tokens/fetch", { id: providerToken }),
    );
    const card = object(token.card ?? {});
    const method: PaymentMethodRef = {
      ref: string(token.id, providerToken),
      type: string(token.method, "card"),
      brand: nullableString(card.network ?? card.brand),
      last4: nullableString(card.last4),
    };
    await this.references.savePaymentMethod(tenantId, method);
    return method;
  }

  listPaymentMethods(tenantId: string): Promise<PaymentMethodRef[]> {
    return this.references.listPaymentMethods(tenantId);
  }

  async detachPaymentMethod(tenantId: string, ref: string): Promise<void> {
    await this.call("POST", "/v1/tokens/delete", { id: ref });
    await this.references.deletePaymentMethod(tenantId, ref);
  }

  verifyWebhookSignature(
    rawBody: Uint8Array,
    signature: string,
    secret: string,
  ): boolean {
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    const provided = Buffer.from(signature, "hex");
    return (
      expected.length === provided.length &&
      timingSafeEqual(expected, provided)
    );
  }

  parseWebhookEvent(rawBody: Uint8Array): BillingEvent {
    const parsed = object(JSON.parse(new TextDecoder().decode(rawBody)));
    return {
      id: string(parsed.id ?? parsed.account_id, "unknown"),
      type: string(parsed.event, "unknown"),
      createdAt: epoch(parsed.created_at),
      payload: parsed as BillingEvent["payload"],
    };
  }

  private async requireSubscriptionRef(tenantId: string): Promise<string> {
    const refs = await this.references.getTenantReferences(tenantId);
    if (!refs?.subscriptionRef) {
      throw new RazorpayBillingError(404, "Subscription reference not found");
    }
    return refs.subscriptionRef;
  }

  private async call(
    method: RazorpayHttpRequest["method"],
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const [keyId, keySecret] = await Promise.all([
      this.secrets.getSecret(this.config.keyIdSecretRef),
      this.secrets.getSecret(this.config.keySecretSecretRef),
    ]);
    const response = await this.http.request({
      method,
      path,
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      ...(body === undefined ? {} : { body }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new RazorpayBillingError(
        response.status,
        "Razorpay billing operation failed",
      );
    }
    return response.body;
  }
}

export class RazorpayBillingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RazorpayBillingError";
  }
}

export function createFetchRazorpayHttpClient(
  baseUrl = "https://api.razorpay.com",
): RazorpayHttpClient {
  return {
    request: async (request) => {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          authorization: request.authorization,
          "content-type": "application/json",
        },
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text.length === 0 ? {} : JSON.parse(text),
      };
    },
  };
}

function mapPlan(value: unknown): BillingPlan {
  const plan = object(value);
  const item = object(plan.item);
  return {
    id: string(plan.id),
    name: string(item.name),
    description: nullableString(item.description),
    amount: number(item.amount),
    currency: string(item.currency),
    interval: number(plan.interval),
    period: period(plan.period),
    active: item.active !== false,
  };
}

function mapSubscription(value: unknown, tenantId: string): Subscription {
  const subscription = object(value);
  return {
    id: string(subscription.id),
    tenantId,
    planId: string(subscription.plan_id),
    status: status(subscription.status),
    currentPeriodStart: nullableEpoch(subscription.current_start),
    currentPeriodEnd: nullableEpoch(subscription.current_end),
    providerCustomerRef: nullableString(subscription.customer_id),
  };
}

function mapInvoice(value: unknown): Invoice {
  const invoice = object(value);
  return {
    id: string(invoice.id),
    subscriptionId: nullableString(invoice.subscription_id),
    amount: number(invoice.amount ?? invoice.gross_amount ?? 0),
    currency: string(invoice.currency, "INR"),
    status: string(invoice.status, "unknown"),
    issuedAt: epoch(invoice.issued_at ?? invoice.created_at),
    paidAt: nullableEpoch(invoice.paid_at),
  };
}

function collection(value: unknown): {
  readonly items: readonly unknown[];
} {
  const result = object(value);
  return { items: Array.isArray(result.items) ? result.items : [] };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RazorpayBillingError(502, "Razorpay returned an invalid object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, fallback?: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new RazorpayBillingError(502, "Razorpay returned an invalid string");
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new RazorpayBillingError(502, "Razorpay returned an invalid number");
}

function epoch(value: unknown): string {
  return new Date(number(value) * 1_000).toISOString();
}

function nullableEpoch(value: unknown): string | null {
  return value === null || value === undefined ? null : epoch(value);
}

function parseCursor(cursor: string): number {
  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RazorpayBillingError(400, "Invoice cursor is invalid");
  }
  return parsed;
}

function period(value: unknown): BillingPlan["period"] {
  if (
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "yearly"
  ) {
    return value;
  }
  throw new RazorpayBillingError(502, "Razorpay returned an invalid period");
}

function status(value: unknown): Subscription["status"] {
  if (
    value === "created" ||
    value === "authenticated" ||
    value === "active" ||
    value === "pending" ||
    value === "halted" ||
    value === "cancelled" ||
    value === "completed" ||
    value === "expired"
  ) {
    return value;
  }
  throw new RazorpayBillingError(502, "Razorpay returned an invalid status");
}
