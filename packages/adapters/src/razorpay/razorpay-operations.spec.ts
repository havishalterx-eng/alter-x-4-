import { createMockSecretsProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";
import {
  RazorpayBillingProvider,
  type BillingReferenceStore,
  type RazorpayHttpClient,
} from "./razorpay-billing-provider";

describe("Razorpay billing operations", () => {
  it("creates real refunds with minor units, configured speed, and reason note", async () => {
    const request = vi.fn<RazorpayHttpClient["request"]>().mockResolvedValue({
      status: 200,
      body: {
        id: "rfnd_123",
        payment_id: "pay_123",
        amount: 2_500,
        currency: "INR",
        status: "processed",
        speed_processed: "optimum",
        created_at: 1_785_990_000,
      },
    });
    const provider = createProvider({ request });

    await expect(
      provider.refundPayment("pay_123", 2_500, "optimum", "duplicate charge"),
    ).resolves.toMatchObject({
      id: "rfnd_123",
      paymentRef: "pay_123",
      amount: 2_500,
      speed: "optimum",
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/payments/pay_123/refund",
      authorization: "Basic cnpwX2tleTpyenBfc2VjcmV0",
      body: {
        amount: 2_500,
        speed: "optimum",
        notes: { reason: "duplicate charge" },
      },
    });
  });

  it("uses separate accept and contest endpoints and submits evidence", async () => {
    const request = vi.fn<RazorpayHttpClient["request"]>()
      .mockResolvedValueOnce({ status: 200, body: dispute("lost") })
      .mockResolvedValueOnce({ status: 200, body: dispute("under_review") });
    const provider = createProvider({ request });

    await provider.resolveDispute("disp_123", {
      action: "accept",
      reason: "customer claim valid",
      evidenceRefs: [],
    });
    await provider.resolveDispute("disp_456", {
      action: "contest",
      reason: "service delivered",
      evidenceRefs: ["doc_123"],
    });

    expect(request).toHaveBeenNthCalledWith(1, {
      method: "POST",
      path: "/v1/disputes/disp_123/accept",
      authorization: "Basic cnpwX2tleTpyenBfc2VjcmV0",
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: "PATCH",
      path: "/v1/disputes/disp_456/contest",
      authorization: "Basic cnpwX2tleTpyenBfc2VjcmV0",
      body: {
        summary: "service delivered",
        explanation_letter: ["doc_123"],
        action: "submit",
      },
    });
  });

  it("refuses contest submission without evidence before HTTP call", async () => {
    const request = vi.fn<RazorpayHttpClient["request"]>();
    const provider = createProvider({ request });
    await expect(provider.resolveDispute("disp_123", {
      action: "contest",
      reason: "service delivered",
      evidenceRefs: [],
    })).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });
});

function createProvider(http: RazorpayHttpClient): RazorpayBillingProvider {
  return new RazorpayBillingProvider(
    { keyIdSecretRef: "razorpay/id", keySecretSecretRef: "razorpay/secret" },
    createMockSecretsProvider({
      secrets: {
        "razorpay/id": "rzp_key",
        "razorpay/secret": "rzp_secret",
      },
    }),
    references(),
    http,
  );
}

function references(): BillingReferenceStore {
  return {
    getTenantReferences: async () => null,
    setSubscriptionReferences: async () => undefined,
    savePaymentMethod: async () => undefined,
    listPaymentMethods: async () => [],
    deletePaymentMethod: async () => undefined,
  };
}

function dispute(status: "lost" | "under_review") {
  return {
    id: "disp_123",
    payment_id: "pay_123",
    amount: 2_500,
    currency: "INR",
    status,
    phase: "chargeback",
    respond_by: 1_786_000_000,
  };
}
