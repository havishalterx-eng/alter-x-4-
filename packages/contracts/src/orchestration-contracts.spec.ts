import { describe, expect, it } from "vitest";
import { CanonicalEventSchema } from "../orchestration/v1/canonical-event.schema";
import { TriggerConfigSchema } from "../orchestration/v1/trigger-config.schema";

const canonicalEvent = {
  event_id: "evt_00000000-0000-7000-8000-000000000001",
  event_type: "order.created",
  schema_version: "1.0.0",
  tenant_id: "ten_00000000-0000-7000-8000-000000000001",
  workspace_id: "ws_00000000-0000-7000-8000-000000000001",
  source: "shopify",
  source_account_id: "shop-1",
  subject_id: "order-1",
  conversation_id: "cnv_00000000-0000-7000-8000-000000000001",
  correlation_id: "evt_00000000-0000-7000-8000-000000000002",
  causation_id: "evt_00000000-0000-7000-8000-000000000003",
  idempotency_key: "shopify:event:1",
  occurred_at: "2026-07-24T00:00:00.000Z",
  received_at: "2026-07-24T00:00:01.000Z",
  trigger_id: "trg_00000000-0000-7000-8000-000000000001",
  trigger_version: 1,
  payload: { order_id: "order-1" },
  signature_status: "verified" as const,
};

describe("orchestration v1 contracts", () => {
  it("round-trips a canonical event", () => {
    expect(CanonicalEventSchema.parse(canonicalEvent)).toEqual(canonicalEvent);
  });

  it.each([
    ["missing tenant", { ...canonicalEvent, tenant_id: undefined }],
    [
      "invalid timestamp",
      { ...canonicalEvent, occurred_at: "not-a-timestamp" },
    ],
    ["invalid signature status", { ...canonicalEvent, signature_status: "pending" }],
    [
      "fractional trigger version",
      { ...canonicalEvent, trigger_version: 1.5 },
    ],
  ])("rejects canonical event with %s", (_name, event) => {
    expect(CanonicalEventSchema.safeParse(event).success).toBe(false);
  });

  it.each(["verified", "unverified", "failed"] as const)(
    "accepts canonical event signature_status %s",
    (signature_status) => {
      expect(
        CanonicalEventSchema.safeParse({ ...canonicalEvent, signature_status })
          .success,
      ).toBe(true);
    },
  );

  it("accepts payload_reference without inline payload", () => {
    const { payload, ...eventWithoutPayload } = canonicalEvent;

    expect(
      CanonicalEventSchema.safeParse({
        ...eventWithoutPayload,
        payload_reference: "art_00000000-0000-7000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(payload).toBeDefined();
  });

  it.each([
    {
      kind: "cron",
      cron_expression: "0 * * * *",
      timezone: "Asia/Kolkata",
    },
    { kind: "webhook", provider: "shopify", dedup_window_seconds: 300 },
  ])("round-trips $kind trigger config", (config) => {
    expect(TriggerConfigSchema.parse(config)).toEqual(config);
  });

  it.each([
    { kind: "manual" },
    { kind: "cron", cron_expression: "* * * * *" },
    { kind: "webhook", provider: "shopify", dedup_window_seconds: 1.5 },
  ])("rejects invalid trigger config %#", (config) => {
    expect(TriggerConfigSchema.safeParse(config).success).toBe(false);
  });
});
