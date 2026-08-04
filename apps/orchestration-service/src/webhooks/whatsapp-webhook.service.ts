import { randomUUID, timingSafeEqual } from "node:crypto";

import { verifyWhatsappSignature } from "./whatsapp-signature";
import type { WhatsappAccountRegistryService } from "./whatsapp-account-registry.service";

export class WhatsappSignatureInvalidError extends Error {
  constructor() {
    super("WhatsApp webhook signature is missing or invalid");
    this.name = "WhatsappSignatureInvalidError";
  }
}

export class WhatsappReplayError extends Error {
  constructor(messageId: string) {
    super(
      `WhatsApp message ${messageId} timestamp is outside the acceptable skew window`,
    );
    this.name = "WhatsappReplayError";
  }
}

export class WhatsappVerificationChallengeError extends Error {
  constructor() {
    super("WhatsApp webhook verification handshake failed");
    this.name = "WhatsappVerificationChallengeError";
  }
}

export class WhatsappPayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsappPayloadValidationError";
  }
}

interface OrchestrationTransactionLike {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

export interface OrchestrationTenantStore {
  withTenant<T>(
    tenantId: string,
    operation: (tx: OrchestrationTransactionLike) => Promise<T>,
  ): Promise<T>;
}

export interface WhatsappWebhookConfig {
  readonly appSecret: string;
  readonly verifyToken: string;
  // Retained only for legacy unit fixtures. Runtime configuration no longer
  // supplies these values; production always resolves a signed inbound
  // phone_number_id through WhatsappAccountRegistryService.
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly timestampSkewSeconds: number;
}

// Dispatch input for INGR-7 (webhook -> canonical event -> conversation
// dispatch), independent of whether the underlying event row was newly
// persisted or a duplicate -- Temporal's signal-with-start plus the
// conversation workflow's own messageId dedup make re-dispatch safe, so
// dispatch is attempted for every inbound message in this delivery.
export interface DispatchableInboundMessage {
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly idempotencyKey: string;
  readonly subjectId: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ProcessWebhookResult {
  readonly received: number;
  readonly persisted: number;
  readonly duplicates: number;
  readonly messages: readonly DispatchableInboundMessage[];
}

interface InboundMessage {
  readonly phoneNumberId: string | undefined;
  readonly message: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly from: string;
  readonly timestampSeconds: number;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

function parseJsonOrThrow(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new WhatsappPayloadValidationError(
      "WhatsApp webhook body is not valid JSON",
    );
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

// Extracts every inbound message across every entry/change in the payload,
// pairing each with the phone_number_id of the change it came from. A
// webhook delivery can contain multiple entries and multiple changes per
// entry; status/delivery-receipt changes (no `messages` array) are
// silently skipped here -- this ticket only handles inbound message
// ingestion, not delivery-status ingestion (see PR "Known gaps").
function extractInboundMessages(payload: unknown): readonly InboundMessage[] {
  const root = asRecord(payload);
  if (root === undefined) {
    throw new WhatsappPayloadValidationError(
      "WhatsApp webhook body must be a JSON object",
    );
  }

  const messages: InboundMessage[] = [];
  for (const entry of asArray(root.entry)) {
    const entryRecord = asRecord(entry);
    if (entryRecord === undefined) {
      continue;
    }
    for (const change of asArray(entryRecord.changes)) {
      const changeRecord = asRecord(change);
      const value = asRecord(changeRecord?.value);
      if (value === undefined) {
        continue;
      }
      const metadata = asRecord(value.metadata);
      const phoneNumberId =
        typeof metadata?.phone_number_id === "string"
          ? metadata.phone_number_id
          : undefined;

      for (const rawMessage of asArray(value.messages)) {
        const message = asRecord(rawMessage);
        if (
          message === undefined ||
          typeof message.id !== "string" ||
          typeof message.from !== "string" ||
          typeof message.timestamp !== "string"
        ) {
          throw new WhatsappPayloadValidationError(
            "WhatsApp message is missing required id, from, or timestamp",
          );
        }
        const timestampSeconds = Number(message.timestamp);
        if (!Number.isFinite(timestampSeconds)) {
          throw new WhatsappPayloadValidationError(
            `WhatsApp message ${message.id} has a non-numeric timestamp`,
          );
        }
        messages.push({
          phoneNumberId,
          message,
          id: message.id,
          from: message.from,
          timestampSeconds,
        });
      }
    }
  }
  return messages;
}

function prefixedUuidV7(prefix: "evt"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}

export class WhatsappWebhookService {
  constructor(
    private readonly store: OrchestrationTenantStore,
    private readonly config: WhatsappWebhookConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly registry?: WhatsappAccountRegistryService,
  ) {}

  get tenantId(): string { return this.config.tenantId ?? ""; }
  get workspaceId(): string { return this.config.workspaceId ?? ""; }

  // Meta's GET verification handshake: hub.mode must be "subscribe" and
  // hub.verify_token must match the configured token (constant-time
  // compared, since it's attacker-suppliable and matched against a
  // secret). Returns the challenge to echo back verbatim on success; fails
  // closed (throws) on any mismatch or missing field.
  verifyChallenge(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    if (
      mode !== "subscribe" ||
      token === undefined ||
      challenge === undefined ||
      !constantTimeStringEqual(token, this.config.verifyToken)
    ) {
      throw new WhatsappVerificationChallengeError();
    }
    return challenge;
  }

  async processWebhook(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<ProcessWebhookResult> {
    if (
      !verifyWhatsappSignature(rawBody, signatureHeader, this.config.appSecret)
    ) {
      throw new WhatsappSignatureInvalidError();
    }

    const payload = parseJsonOrThrow(rawBody);
    const messages = extractInboundMessages(payload);

    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    for (const inbound of messages) {
      if (
        Math.abs(nowSeconds - inbound.timestampSeconds) >
        this.config.timestampSkewSeconds
      ) {
        throw new WhatsappReplayError(inbound.id);
      }
    }

    if (messages.length === 0) {
      return { received: 0, persisted: 0, duplicates: 0, messages: [] };
    }

    let persisted = 0;
    let duplicates = 0;
    const routed = await Promise.all(messages.map(async (inbound) => ({
      inbound,
      routing: this.registry
        ? await this.registry.resolveInbound(inbound.phoneNumberId)
        : this.legacyRouting(inbound.phoneNumberId),
    })));
    for (const { inbound, routing } of routed) {
      await this.store.withTenant(routing.tenantId, async (tx) => {
        const result = await tx.query(
          `INSERT INTO events (
             event_id, event_type, schema_version, tenant_id, workspace_id,
             source, source_account_id, subject_id, idempotency_key,
             occurred_at, payload, signature_status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
          [
            prefixedUuidV7("evt"),
            "whatsapp.message.received",
            "1.0.0",
            routing.tenantId,
            routing.workspaceId,
            "whatsapp",
            inbound.phoneNumberId ?? null,
            inbound.from,
            inbound.id,
            new Date(inbound.timestampSeconds * 1000).toISOString(),
            JSON.stringify(inbound.message),
            "verified",
          ],
        );
        if (result.rowCount === 1) {
          persisted += 1;
        } else {
          duplicates += 1;
        }
      });
    }

    return {
      received: messages.length,
      persisted,
      duplicates,
      messages: routed.map(({ inbound, routing }) => dispatchableMessage(inbound, routing)),
    };
  }

  private legacyRouting(phoneNumberId: string | undefined) {
    if (!this.config.tenantId || !this.config.workspaceId) {
      throw new Error(`No WhatsApp registry is configured for phone number ${phoneNumberId ?? "unknown"}`);
    }
    return { accountId: "legacy-test-account", tenantId: this.config.tenantId, workspaceId: this.config.workspaceId };
  }
}

function dispatchableMessage(
  inbound: InboundMessage,
  routing: { readonly tenantId: string; readonly workspaceId: string },
): DispatchableInboundMessage {
  const message: DispatchableInboundMessage = {
    idempotencyKey: inbound.id,
    subjectId: inbound.from,
    occurredAt: new Date(inbound.timestampSeconds * 1000).toISOString(),
    payload: inbound.message,
  };
  // Routing is internal dispatch metadata, not part of the webhook response
  // contract. Non-enumerability preserves the established response shape.
  Object.defineProperties(message, {
    tenantId: { value: routing.tenantId, enumerable: false },
    workspaceId: { value: routing.workspaceId, enumerable: false },
  });
  return message;
}
