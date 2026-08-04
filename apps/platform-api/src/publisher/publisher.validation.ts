import { z } from "zod";
import { PublisherHttpError } from "./publisher.problem";
import type { ListingTransitionInput, ReviewKycInput, SubmitVerificationInput } from "./types";

const documentSchema = z.object({ type: z.enum(["tax_id", "bank_proof"]), objectRef: z.string().min(1).max(2_048) }).strict();
const verificationSchema = z.object({ documents: z.array(documentSchema).length(2).refine((documents) => new Set(documents.map((document) => document.type)).size === 2, "Tax ID and bank proof are both required") }).strict();
const reviewSchema = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().min(1).max(1_000).optional() }).strict().superRefine((value, context) => { if (value.decision === "rejected" && !value.reason) context.addIssue({ code: "custom", message: "Rejection reason is required", path: ["reason"] }); });
const transitionSchema = z.object({ status: z.enum(["draft", "private_testing", "submitted", "automated_review", "human_review", "published", "suspended", "deprecated", "removed"]) }).strict();

export function parseVerification(input: unknown, instance: string): SubmitVerificationInput { return parse(verificationSchema, input, instance); }
export function parseReview(input: unknown, instance: string): ReviewKycInput {
  const value = parse(reviewSchema, input, instance);
  return value.reason === undefined
    ? { decision: value.decision }
    : { decision: value.decision, reason: value.reason };
}
export function parseTransition(input: unknown, instance: string): ListingTransitionInput { return parse(transitionSchema, input, instance); }

function parse<T>(schema: z.ZodType<T>, input: unknown, instance: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new PublisherHttpError(400, "INVALID_PUBLISHER_REQUEST", result.error.issues.map((issue) => issue.message).join("; "), instance);
}
