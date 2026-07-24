import { describe, expect, it } from "vitest";
import { CanonicalEventSchema } from "./canonical-event";
import { ids, timestamp } from "./test-fixtures";

const validEvent = {
  event_id: ids.event,
  event_type: "lead.created",
  schema_version: "1.0.0",
  tenant_id: ids.tenant,
  workspace_id: ids.workspace,
  source: "crm",
  source_account_id: "external-account-42",
  subject_id: "external-lead-7",
  conversation_id: ids.conversation,
  correlation_id: ids.event,
  idempotency_key: "provider-event-42",
  occurred_at: timestamp,
  received_at: timestamp,
  trigger_id: ids.trigger,
  trigger_version: 1,
  payload: { lead_name: "Ada" },
  signature_status: "verified",
};

describe("CanonicalEventSchema", () => {
  it("contains exactly the 19 spec-defined fields", () => {
    expect(Object.keys(CanonicalEventSchema.shape)).toEqual([
      "event_id",
      "event_type",
      "schema_version",
      "tenant_id",
      "workspace_id",
      "source",
      "source_account_id",
      "subject_id",
      "conversation_id",
      "correlation_id",
      "causation_id",
      "idempotency_key",
      "occurred_at",
      "received_at",
      "trigger_id",
      "trigger_version",
      "payload",
      "payload_reference",
      "signature_status",
    ]);
  });

  it("accepts the exact canonical event shape", () => {
    expect(CanonicalEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it("requires either payload or payload_reference", () => {
    const withoutPayload = { ...validEvent, payload: undefined };

    expect(() => CanonicalEventSchema.parse(withoutPayload)).toThrow(
      /payload_reference/,
    );
  });

  it("rejects an invalid signature status", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...validEvent,
        signature_status: "trusted",
      }).success,
    ).toBe(false);
  });

  it("allows inline and referenced payloads together", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...validEvent,
        payload_reference: ids.artifact,
      }).success,
    ).toBe(true);
  });

  it("accepts untriggered events only when both trigger fields are absent", () => {
    const event: Record<string, unknown> = { ...validEvent };
    delete event.trigger_id;
    delete event.trigger_version;

    expect(CanonicalEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    ["missing trigger_version", { ...validEvent, trigger_version: undefined }],
    ["missing trigger_id", { ...validEvent, trigger_id: undefined }],
  ])("rejects partial trigger linkage with %s", (_name, event) => {
    expect(CanonicalEventSchema.safeParse(event).success).toBe(false);
  });
});
