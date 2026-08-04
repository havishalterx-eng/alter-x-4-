import { describe, expect, it } from "vitest";
import { createMockKycProvider } from "./kyc-provider";

describe("createMockKycProvider", () => {
  it("queues a manual-review submission", async () => {
    const provider = createMockKycProvider();
    const submission = await provider.submitVerification("ten_1", [
      { type: "tax_id", objectRef: "s3://private/tax" },
      { type: "bank_proof", objectRef: "s3://private/bank" },
    ]);
    expect(submission.status).toBe("pending_review");
    await expect(provider.getVerificationStatus("ten_1")).resolves.toEqual(submission);
  });
});
