import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type { KycDocumentRef, KycProvider, KycSubmission, ProviderMetadata } from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_KYC_CAPABILITIES: ProviderCapabilities = mockCapabilities(65_536);

export interface MockKycProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"KycProvider">;
  readonly capabilities?: ProviderCapabilities;
}

export function createMockKycProvider(options: MockKycProviderOptions = {}): KycProvider {
  const submissions = new Map<string, KycSubmission>();
  const providerId = options.providerId ?? "mock.kyc";
  return createMockProvider<KycProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "KycProvider"),
    capabilities: options.capabilities ?? MOCK_KYC_CAPABILITIES,
    implementation: {
      submitVerification: async (tenantId: string, documents: readonly KycDocumentRef[]) => {
        const submission: KycSubmission = {
          id: `kyc_${tenantId}`,
          tenantId,
          documents,
          status: "pending_review",
          rejectionReason: null,
          submittedAt: "1970-01-01T00:00:00.000Z",
          reviewedAt: null,
        };
        submissions.set(tenantId, submission);
        return submission;
      },
      getVerificationStatus: async (tenantId: string) => submissions.get(tenantId) ?? null,
    },
  });
}
