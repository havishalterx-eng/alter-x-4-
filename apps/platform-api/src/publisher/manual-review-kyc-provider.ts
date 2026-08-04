import type { ProviderCapabilities } from "@alterx/contracts";
import { Injectable } from "@nestjs/common";
import type { KycDocumentRef, KycProvider, KycSubmission, ProviderHealth, ProviderMetadata } from "@alterx/shared-clients";
import { publisherId } from "./publisher-id";
import { PublisherRepository } from "./publisher.repository";

const capabilities: ProviderCapabilities = {
  streaming: false, tool_calling: false, vision: false, structured_output: true,
  long_context: false, regional_availability: ["local"], data_residency: ["IN"],
  batch_support: false, maximum_payload: 65_536, supported_languages: ["en"], cost_model: { rates: [] },
};
const metadata: ProviderMetadata<"KycProvider"> = {
  providerId: "manual-review", interfaceName: "KycProvider", displayName: "Manual KYC review",
  version: "1.0.0", telemetryNamespace: "alterx.publisher.kyc.manual-review",
  supportsTenantOverrides: false, migration: { strategyVersion: "manual-review-v1", rollbackSupported: true },
};

/** Deliberate no-vendor KYC adapter until an identity-verification vendor is selected. */
@Injectable()
export class ManualReviewKycProvider implements KycProvider {
  readonly metadata = metadata;
  readonly capabilities = capabilities;
  constructor(private readonly repository: PublisherRepository) {}
  healthCheck(): Promise<ProviderHealth> { return Promise.resolve({ status: "healthy", checkedAt: new Date().toISOString(), latencyMs: 0 }); }
  submitVerification(tenantId: string, documents: readonly KycDocumentRef[]): Promise<KycSubmission> {
    return this.repository.createSubmission(tenantId, publisherId("pub"), publisherId("kyc"), documents);
  }
  getVerificationStatus(tenantId: string): Promise<KycSubmission | null> { return this.repository.latestSubmission(tenantId); }
}
