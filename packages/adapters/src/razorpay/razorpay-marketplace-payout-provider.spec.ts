import { describe, expect, it, vi } from "vitest";
import { createMockSecretsProvider } from "@alterx/shared-clients";
import { RazorpayMarketplacePayoutProvider } from "./razorpay-marketplace-payout-provider";

describe("RazorpayMarketplacePayoutProvider", () => {
  it("uses integer 80/20 Route transfers with remainder retained by platform", async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, body: { id: "order_route_1", status: "created" } });
    const provider = new RazorpayMarketplacePayoutProvider(
      { keyIdSecretRef: "key-id", keySecretSecretRef: "key-secret" },
      createMockSecretsProvider({ secrets: { "key-id": "rzp_test_id", "key-secret": "rzp_test_secret" } }),
      { request },
    );
    await expect(provider.createSplitOrder("ord_1", "acc_seller", "10005", 8000)).resolves.toEqual({
      payoutId: "order_route_1", orderRef: "ord_1", sellerShareMinor: "8004", platformShareMinor: "2001", status: "created",
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST", path: "/v1/orders", body: expect.objectContaining({ amount: "10005", currency: "INR", receipt: "ord_1", transfers: [{ account: "acc_seller", amount: "8004", currency: "INR" }] }),
    }));
  });

  it("rejects float-like money and invalid split rates", async () => {
    const provider = new RazorpayMarketplacePayoutProvider(
      { keyIdSecretRef: "key-id", keySecretSecretRef: "key-secret" }, createMockSecretsProvider(), { request: vi.fn() },
    );
    await expect(provider.createSplitOrder("ord_1", "acc_seller", "10.50", 8000)).rejects.toThrow("totalMinor must be a positive integer string");
    await expect(provider.createSplitOrder("ord_1", "acc_seller", "10", 10_001)).rejects.toThrow("sellerShareBps must be between 0 and 10000");
  });
});
