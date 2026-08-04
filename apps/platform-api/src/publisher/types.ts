import type { KycDocumentRef, KycSubmission } from "@alterx/shared-clients";
import type { ListingStatus } from "../marketplace/types";

export type PublisherVerificationStatus = "unverified" | "pending_review" | "verified" | "rejected";
export type PayoutRecordStatus = "created" | "pending" | "processed" | "failed";

export interface PublisherRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly verificationStatus: PublisherVerificationStatus;
  readonly createdAt: Date;
}

export interface PayoutRecord {
  readonly id: string;
  readonly orderId: string;
  readonly totalMinor: string;
  readonly sellerShareMinor: string;
  readonly platformShareMinor: string;
  readonly status: PayoutRecordStatus;
  readonly createdAt: Date;
}

export interface EarningsSummary {
  readonly availableMinor: string;
  readonly pendingMinor: string;
  readonly paidMinor: string;
  readonly currency: "INR";
}

export interface SubmitVerificationInput {
  readonly documents: readonly KycDocumentRef[];
}

export interface ReviewKycInput {
  readonly decision: "approved" | "rejected";
  readonly reason?: string;
}

export interface ListingTransitionInput {
  readonly status: ListingStatus;
}

export type { KycDocumentRef, KycSubmission };
