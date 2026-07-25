import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  WhatsappPayloadValidationError,
  WhatsappReplayError,
  WhatsappSignatureInvalidError,
  WhatsappVerificationChallengeError,
  WhatsappWebhookService,
  type OrchestrationTenantStore,
} from "./whatsapp-webhook.service";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";
const TENANT_ID = "ten_a";
const WORKSPACE_ID = "ws_a";
const NOW = new Date("2026-07-26T12:00:00.000Z");

const CONFIG = {
  appSecret: APP_SECRET,
  verifyToken: VERIFY_TOKEN,
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  timestampSkewSeconds: 300,
};

function createFakeStore(existing: readonly string[] = []): {
  readonly store: OrchestrationTenantStore;
  readonly inserts: unknown[][];
} {
  const seen = new Set(existing);
  const inserts: unknown[][] = [];
  const store: OrchestrationTenantStore = {
    async withTenant(_tenantId, operation) {
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
          values: readonly unknown[] = [],
        ) {
          void statement;
          inserts.push([...values]);
          const idempotencyKey = values[8] as string;
          if (seen.has(idempotencyKey)) {
            return { rowCount: 0, rows: [] as readonly TRow[] };
          }
          seen.add(idempotencyKey);
          return { rowCount: 1, rows: [] as readonly TRow[] };
        },
      });
    },
  };
  return { store, inserts };
}

function payloadWithMessages(
  messages: readonly Record<string, unknown>[],
  phoneNumberId = "1234567890",
): Buffer {
  const body = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_1",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              messages,
            },
            field: "messages",
          },
        ],
      },
    ],
  };
  return Buffer.from(JSON.stringify(body));
}

function signatureFor(body: Buffer, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function message(
  overrides: Partial<{ id: string; from: string; timestamp: string }> = {},
): Record<string, unknown> {
  return {
    id: "wamid.ABC123",
    from: "16505551234",
    timestamp: String(Math.floor(NOW.getTime() / 1000)),
    type: "text",
    text: { body: "hi" },
    ...overrides,
  };
}

describe("WhatsappWebhookService.verifyChallenge", () => {
  it("returns the challenge when mode and token match", () => {
    const { store } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    expect(
      service.verifyChallenge("subscribe", VERIFY_TOKEN, "challenge-123"),
    ).toBe("challenge-123");
  });

  it.each([
    ["wrong mode", "unsubscribe", VERIFY_TOKEN, "c"],
    ["wrong token", "subscribe", "wrong-token", "c"],
    ["missing token", "subscribe", undefined, "c"],
    ["missing challenge", "subscribe", VERIFY_TOKEN, undefined],
  ])("rejects %s", (_name, mode, token, challenge) => {
    const { store } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    expect(() => service.verifyChallenge(mode, token, challenge)).toThrow(
      WhatsappVerificationChallengeError,
    );
  });
});

describe("WhatsappWebhookService.processWebhook", () => {
  it("rejects an invalid signature before touching the store", async () => {
    const { store, inserts } = createFakeStore();
    const withTenant = vi.spyOn(store, "withTenant");
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const body = payloadWithMessages([message()]);

    await expect(
      service.processWebhook(body, "sha256=" + "0".repeat(64)),
    ).rejects.toThrow(WhatsappSignatureInvalidError);
    expect(withTenant).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("persists a new message and reports it as received+persisted", async () => {
    const { store, inserts } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const body = payloadWithMessages([message()]);

    const result = await service.processWebhook(body, signatureFor(body));

    expect(result).toEqual({
      received: 1,
      persisted: 1,
      duplicates: 0,
      messages: [
        {
          idempotencyKey: "wamid.ABC123",
          subjectId: "16505551234",
          occurredAt: NOW.toISOString(),
          payload: message(),
        },
      ],
    });
    expect(inserts).toHaveLength(1);
    const [insertValues] = inserts;
    expect(insertValues![3]).toBe(TENANT_ID);
    expect(insertValues![4]).toBe(WORKSPACE_ID);
    expect(insertValues![5]).toBe("whatsapp");
    expect(insertValues![6]).toBe("1234567890");
    expect(insertValues![7]).toBe("16505551234");
    expect(insertValues![8]).toBe("wamid.ABC123");
    expect(insertValues![11]).toBe("verified");
  });

  it("dedups a retried message via ON CONFLICT DO NOTHING semantics", async () => {
    const { store } = createFakeStore(["wamid.ABC123"]);
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const body = payloadWithMessages([message()]);

    const result = await service.processWebhook(body, signatureFor(body));

    expect(result).toEqual({
      received: 1,
      persisted: 0,
      duplicates: 1,
      messages: [
        {
          idempotencyKey: "wamid.ABC123",
          subjectId: "16505551234",
          occurredAt: NOW.toISOString(),
          payload: message(),
        },
      ],
    });
  });

  it("handles a mix of new and duplicate messages in one payload", async () => {
    const { store } = createFakeStore(["wamid.OLD"]);
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const body = payloadWithMessages([
      message({ id: "wamid.OLD" }),
      message({ id: "wamid.NEW" }),
    ]);

    const result = await service.processWebhook(body, signatureFor(body));

    expect(result).toEqual({
      received: 2,
      persisted: 1,
      duplicates: 1,
      messages: [
        {
          idempotencyKey: "wamid.OLD",
          subjectId: "16505551234",
          occurredAt: NOW.toISOString(),
          payload: message({ id: "wamid.OLD" }),
        },
        {
          idempotencyKey: "wamid.NEW",
          subjectId: "16505551234",
          occurredAt: NOW.toISOString(),
          payload: message({ id: "wamid.NEW" }),
        },
      ],
    });
  });

  it("rejects a message whose timestamp is outside the skew window", async () => {
    const { store, inserts } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const staleTimestamp = String(
      Math.floor(NOW.getTime() / 1000) - CONFIG.timestampSkewSeconds - 60,
    );
    const body = payloadWithMessages([message({ timestamp: staleTimestamp })]);

    await expect(
      service.processWebhook(body, signatureFor(body)),
    ).rejects.toThrow(WhatsappReplayError);
    expect(inserts).toHaveLength(0);
  });

  it("accepts a message right at the edge of the skew window", async () => {
    const { store } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const edgeTimestamp = String(
      Math.floor(NOW.getTime() / 1000) - CONFIG.timestampSkewSeconds,
    );
    const body = payloadWithMessages([message({ timestamp: edgeTimestamp })]);

    await expect(
      service.processWebhook(body, signatureFor(body)),
    ).resolves.toEqual({
      received: 1,
      persisted: 1,
      duplicates: 0,
      messages: [
        {
          idempotencyKey: "wamid.ABC123",
          subjectId: "16505551234",
          occurredAt: new Date(Number(edgeTimestamp) * 1000).toISOString(),
          payload: message({ timestamp: edgeTimestamp }),
        },
      ],
    });
  });

  it("rejects malformed JSON after a valid signature", async () => {
    const { store, inserts } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const body = Buffer.from("not json");

    await expect(
      service.processWebhook(body, signatureFor(body)),
    ).rejects.toThrow(WhatsappPayloadValidationError);
    expect(inserts).toHaveLength(0);
  });

  it("rejects a message missing required fields", async () => {
    const { store } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const body = payloadWithMessages([{ type: "text" }]);

    await expect(
      service.processWebhook(body, signatureFor(body)),
    ).rejects.toThrow(WhatsappPayloadValidationError);
  });

  it("acks status-only payloads (no messages array) without writing to the store", async () => {
    const { store, inserts } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const statusPayload = Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "waba_1",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: "1234567890" },
                  statuses: [{ id: "wamid.ABC123", status: "delivered" }],
                },
                field: "messages",
              },
            ],
          },
        ],
      }),
    );

    const result = await service.processWebhook(
      statusPayload,
      signatureFor(statusPayload),
    );

    expect(result).toEqual({
      received: 0,
      persisted: 0,
      duplicates: 0,
      messages: [],
    });
    expect(inserts).toHaveLength(0);
  });

  it("never includes the app secret or raw signature in any thrown error message", async () => {
    const { store } = createFakeStore();
    const service = new WhatsappWebhookService(store, CONFIG, () => NOW);
    const body = payloadWithMessages([message()]);
    const badSignature = "sha256=" + "f".repeat(64);

    try {
      await service.processWebhook(body, badSignature);
      throw new Error("expected processWebhook to throw");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(APP_SECRET);
      expect(message).not.toContain(badSignature);
    }
  });
});
