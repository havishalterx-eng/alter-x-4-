import type { BillingProvider } from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";
import {
  StripeBillingNotActivatedError,
  StripeBillingProvider,
} from "./stripe-billing-provider";

describe("StripeBillingProvider", () => {
  it("is registerable but never returns synthetic billing success", async () => {
    const provider: BillingProvider = new StripeBillingProvider();
    expect(provider.metadata.featureFlag).toBe("billing.stripe.enabled");
    expect((await provider.healthCheck()).status).toBe("degraded");
    const outcomes = await Promise.allSettled([
      provider.listPlans(),
      provider.getSubscription("tenant"),
      provider.createSubscription("tenant", "plan", "token"),
      provider.changeSubscription("tenant", "plan"),
      provider.cancelSubscription("tenant"),
      provider.listInvoices("tenant"),
      provider.attachPaymentMethod("tenant", "token"),
      provider.listPaymentMethods("tenant"),
      provider.detachPaymentMethod("tenant", "token"),
    ]);
    expect(outcomes).toHaveLength(9);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(
          StripeBillingNotActivatedError,
        );
      }
    }
    expect(() =>
      provider.verifyWebhookSignature(
        new Uint8Array(),
        "signature",
        "secret",
      ),
    ).toThrow(StripeBillingNotActivatedError);
    expect(() => provider.parseWebhookEvent(new Uint8Array())).toThrow(
      StripeBillingNotActivatedError,
    );
  });
});
