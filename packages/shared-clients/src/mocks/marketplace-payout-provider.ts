import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type { MarketplacePayoutProvider, PayoutSplitResult, PayoutStatus, ProviderMetadata } from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_MARKETPLACE_PAYOUT_CAPABILITIES: ProviderCapabilities = mockCapabilities(65_536);

export interface MockMarketplacePayoutProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"MarketplacePayoutProvider">;
  readonly capabilities?: ProviderCapabilities;
}

export function createMockMarketplacePayoutProvider(
  options: MockMarketplacePayoutProviderOptions = {},
): MarketplacePayoutProvider {
  const payouts = new Map<string, PayoutStatus>();
  const providerId = options.providerId ?? "mock.marketplace-payout";
  return createMockProvider<MarketplacePayoutProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "MarketplacePayoutProvider"),
    capabilities: options.capabilities ?? MOCK_MARKETPLACE_PAYOUT_CAPABILITIES,
    implementation: {
      createSplitOrder: async (orderId, _sellerAccountRef, totalMinor, sellerShareBps) => {
        const total = BigInt(totalMinor);
        const sellerShareMinor = (total * BigInt(sellerShareBps)) / 10_000n;
        const payoutId = `payout_${orderId}`;
        const status: PayoutStatus = { payoutId, status: "created", processedAt: null };
        payouts.set(payoutId, status);
        const result: PayoutSplitResult = {
          ...status,
          orderRef: orderId,
          sellerShareMinor: sellerShareMinor.toString(),
          platformShareMinor: (total - sellerShareMinor).toString(),
        };
        return result;
      },
      getPayoutStatus: async (payoutId) => payouts.get(payoutId) ?? { payoutId, status: "failed", processedAt: null },
    },
  });
}
