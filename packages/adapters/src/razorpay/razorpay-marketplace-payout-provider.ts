import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  MarketplacePayoutProvider,
  PayoutSplitResult,
  PayoutStatus,
  ProviderHealth,
  ProviderMetadata,
  SecretsProvider,
} from "@alterx/shared-clients";
import {
  createFetchRazorpayHttpClient,
  type RazorpayHttpClient,
  type RazorpayHttpRequest,
} from "./razorpay-billing-provider";

export interface RazorpayMarketplacePayoutProviderConfig {
  readonly keyIdSecretRef: string;
  readonly keySecretSecretRef: string;
  readonly currency?: "INR";
}

export const RAZORPAY_MARKETPLACE_PAYOUT_CAPABILITIES: ProviderCapabilities = {
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

const metadata: ProviderMetadata<"MarketplacePayoutProvider"> = {
  providerId: "razorpay-route",
  interfaceName: "MarketplacePayoutProvider",
  displayName: "Razorpay Route",
  version: "1.0.0",
  telemetryNamespace: "alterx.adapters.razorpay.marketplace-payout",
  supportsTenantOverrides: false,
  migration: { strategyVersion: "razorpay-route-v1", rollbackSupported: true },
};

export class RazorpayMarketplacePayoutProvider implements MarketplacePayoutProvider {
  readonly metadata = metadata;
  readonly capabilities = RAZORPAY_MARKETPLACE_PAYOUT_CAPABILITIES;

  constructor(
    private readonly config: RazorpayMarketplacePayoutProviderConfig,
    private readonly secrets: SecretsProvider,
    private readonly http: RazorpayHttpClient = createFetchRazorpayHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async healthCheck(): Promise<ProviderHealth> {
    const started = this.now().getTime();
    try {
      await this.call("GET", "/v1/orders?count=1");
      const checkedAt = this.now();
      return { status: "healthy", checkedAt: checkedAt.toISOString(), latencyMs: checkedAt.getTime() - started };
    } catch {
      const checkedAt = this.now();
      return { status: "unhealthy", checkedAt: checkedAt.toISOString(), latencyMs: checkedAt.getTime() - started };
    }
  }

  async createSplitOrder(
    orderId: string,
    sellerAccountRef: string,
    totalMinor: string,
    sellerShareBps: number,
  ): Promise<PayoutSplitResult> {
    const total = positiveMinor(totalMinor);
    if (!Number.isInteger(sellerShareBps) || sellerShareBps < 0 || sellerShareBps > 10_000) {
      throw new RazorpayMarketplacePayoutError(400, "sellerShareBps must be between 0 and 10000");
    }
    const sellerShare = (total * BigInt(sellerShareBps)) / 10_000n;
    const order = object(await this.call("POST", "/v1/orders", {
      amount: total.toString(),
      currency: this.config.currency ?? "INR",
      receipt: orderId,
      transfers: [{ account: sellerAccountRef, amount: sellerShare.toString(), currency: this.config.currency ?? "INR" }],
      notes: { marketplace_order_id: orderId },
    }));
    return {
      payoutId: requiredString(order.id, "Route order", "id"),
      orderRef: orderId,
      sellerShareMinor: sellerShare.toString(),
      platformShareMinor: (total - sellerShare).toString(),
      status: routeStatus(order.status),
    };
  }

  async getPayoutStatus(payoutId: string): Promise<PayoutStatus> {
    const transfer = object(await this.call("GET", `/v1/transfers/${encodeURIComponent(payoutId)}`));
    return {
      payoutId,
      status: routeStatus(transfer.status),
      processedAt: typeof transfer.processed_at === "number" ? new Date(transfer.processed_at * 1_000).toISOString() : null,
    };
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
      throw new RazorpayMarketplacePayoutError(response.status, "Razorpay Route operation failed");
    }
    return response.body;
  }
}

export class RazorpayMarketplacePayoutError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "RazorpayMarketplacePayoutError";
  }
}

function positiveMinor(value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new RazorpayMarketplacePayoutError(400, "totalMinor must be a positive integer string");
  }
  return BigInt(value);
}

function routeStatus(value: unknown): PayoutStatus["status"] {
  if (value === "processed" || value === "paid") return "processed";
  if (value === "failed") return "failed";
  if (value === "pending" || value === "created") return value;
  return "pending";
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RazorpayMarketplacePayoutError(502, "Razorpay Route returned an invalid response");
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, resource: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RazorpayMarketplacePayoutError(502, `${resource} response missing ${field}`);
  }
  return value;
}
