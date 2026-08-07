import { describe, expect, it } from "vitest";
import {
  CreateJitGrantRequestSchema,
  MarketplaceGovernanceActionRequestSchema,
  RefundPaymentRequestSchema,
  ResolveDisputeRequestSchema,
  UpdateProviderControlRequestSchema,
} from "./operations";

describe("Operations contracts", () => {
  it("requires explicit JIT scopes and bounded lifetime", () => {
    const input = {
      staff_user_id: "stf_support",
      tenant_id: "f0204070-2fd2-4bb7-a117-3222301822fe",
      reason_code: "support_case",
      reason_text: "Investigate failed workflow",
      duration_minutes: 30,
      scopes: ["runs:read"],
    };
    expect(CreateJitGrantRequestSchema.parse(input)).toEqual(input);
    expect(() => CreateJitGrantRequestSchema.parse({ ...input, scopes: [] })).toThrow();
    expect(() => CreateJitGrantRequestSchema.parse({ ...input, duration_minutes: 481 })).toThrow();
  });

  it("rejects provider updates with no real control change", () => {
    expect(() => UpdateProviderControlRequestSchema.parse({ reason: "none" })).toThrow();
    expect(UpdateProviderControlRequestSchema.parse({
      active: false,
      reason: "provider incident",
    })).toMatchObject({ active: false });
  });

  it("requires positive minor units for refunds", () => {
    expect(() => RefundPaymentRequestSchema.parse({
      payment_ref: "pay_123",
      amount_minor: 0,
      reason: "duplicate payment",
    })).toThrow();
  });

  it("requires evidence when contesting a dispute", () => {
    expect(() => ResolveDisputeRequestSchema.parse({
      action: "contest",
      reason: "service delivered",
    })).toThrow();
    expect(ResolveDisputeRequestSchema.parse({
      action: "accept",
      reason: "claim valid",
    }).evidence_refs).toEqual([]);
  });

  it("binds trust levels only to set_trust", () => {
    expect(() => MarketplaceGovernanceActionRequestSchema.parse({
      action: "takedown",
      reason: "malware",
      trust_level: "blocked",
    })).toThrow();
  });
});
