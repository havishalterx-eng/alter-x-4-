import { Inject, Injectable } from "@nestjs/common";

import type {
  RecordEventRequest,
  RecordEventResponse,
} from "@alterx/contracts";
import {
  AUDIT_STORE_PROVIDER,
  AuditValidationError,
  verifyAuditChain,
  type AuditActorType,
  type AuditChainVerificationResult,
  type AuditEventHandler,
  type AuditResult,
  type AuditStoreProvider,
  type JsonValue,
} from "@alterx/shared-clients";

import { auditId, createUuidV7 } from "./audit-id";
import {
  ACTOR_TYPES,
  AUDIT_RESULTS,
  type ValidatedAuditEvent,
} from "./audit.types";

const TENANT_ID_PATTERN =
  /^ten_([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const FORBIDDEN_CONTEXT_KEYS = new Set([
  "body",
  "content",
  "conversation",
  "credential",
  "file",
  "input",
  "message",
  "output",
  "password",
  "payload",
  "prompt",
  "secret",
  "token",
]);
const ALLOWED_CONTEXT_KEYS = new Set(["ip_class", "request_id", "scope"]);
const MAX_CONTEXT_BYTES = 8_192;
const MAX_TEXT_LENGTH = 512;

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new AuditValidationError(`${field} is required`);
  }
  if (Buffer.byteLength(normalized, "utf8") > MAX_TEXT_LENGTH) {
    throw new AuditValidationError(`${field} exceeds ${MAX_TEXT_LENGTH} bytes`);
  }
  return normalized;
}

function optionalText(value: string, field: string): string | null {
  return value.trim().length === 0 ? null : requiredText(value, field);
}

function parseTenantId(value: string): string | null {
  if (value.trim().length === 0) {
    return null;
  }
  const match = TENANT_ID_PATTERN.exec(value.trim());
  if (match?.[1] === undefined) {
    throw new AuditValidationError("tenant_id must be a ten_ prefixed UUIDv7");
  }
  return match[1];
}

function assertContextKeys(value: unknown, path = "context"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertContextKeys(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replaceAll(/[_-]/g, "");
    if (
      [...FORBIDDEN_CONTEXT_KEYS].some((forbidden) =>
        normalizedKey.includes(forbidden),
      )
    ) {
      throw new AuditValidationError(`${path}.${key} is not permitted`);
    }
    assertContextKeys(nested, `${path}.${key}`);
  }
}

function parseContext(value: string): Readonly<Record<string, JsonValue>> | null {
  if (value.trim().length === 0) {
    return null;
  }
  if (Buffer.byteLength(value, "utf8") > MAX_CONTEXT_BYTES) {
    throw new AuditValidationError(
      `context_json exceeds ${MAX_CONTEXT_BYTES} bytes`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new AuditValidationError("context_json must contain valid JSON");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new AuditValidationError("context_json must contain a JSON object");
  }
  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) {
      throw new AuditValidationError(`context.${key} is not permitted`);
    }
  }
  assertContextKeys(parsed);
  return parsed as Readonly<Record<string, JsonValue>>;
}

function parseOccurredAt(value: string): Date {
  if (!ISO_8601_PATTERN.test(value)) {
    throw new AuditValidationError("occurred_at must be an ISO 8601 timestamp");
  }
  const occurredAt = new Date(value);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new AuditValidationError("occurred_at must be a valid timestamp");
  }
  return occurredAt;
}

function requiresReasonCode(actorType: AuditActorType, action: string): boolean {
  const normalizedAction = action.toLowerCase();
  return (
    actorType === "support" ||
    normalizedAction.startsWith("support.access") ||
    normalizedAction.includes("break_glass") ||
    normalizedAction.includes("break-glass")
  );
}

function validateRequest(request: RecordEventRequest): ValidatedAuditEvent {
  const actorType = requiredText(request.actor_type, "actor_type");
  if (!ACTOR_TYPES.includes(actorType as AuditActorType)) {
    throw new AuditValidationError("actor_type is not supported");
  }
  const result = requiredText(request.result, "result");
  if (!AUDIT_RESULTS.includes(result as AuditResult)) {
    throw new AuditValidationError("result is not supported");
  }

  const targetType = optionalText(request.target_type, "target_type");
  const targetRef = optionalText(request.target_ref, "target_ref");
  if ((targetType === null) !== (targetRef === null)) {
    throw new AuditValidationError(
      "target_type and target_ref must either both be set or both be empty",
    );
  }

  const action = requiredText(request.action, "action");
  const reasonCode = optionalText(request.reason_code, "reason_code");
  if (
    requiresReasonCode(actorType as AuditActorType, action) &&
    reasonCode === null
  ) {
    throw new AuditValidationError(
      "reason_code is required for support and break-glass access",
    );
  }

  return {
    tenantId: parseTenantId(request.tenant_id),
    tenantPseudonym: null,
    actorType: actorType as AuditActorType,
    actorRef: requiredText(request.actor_ref, "actor_ref"),
    action,
    targetType,
    targetRef,
    result: result as AuditResult,
    reasonCode,
    context: parseContext(request.context_json),
    occurredAt: parseOccurredAt(request.occurred_at),
  };
}

@Injectable()
export class AuditService implements AuditEventHandler {
  constructor(
    @Inject(AUDIT_STORE_PROVIDER)
    private readonly store: AuditStoreProvider,
  ) {}

  async recordEvent(request: RecordEventRequest): Promise<RecordEventResponse> {
    const stored = await this.store.append({
      ...validateRequest(request),
      id: createUuidV7(),
    });
    return {
      id: auditId(stored.id),
      entry_hash: stored.entryHash.toString("hex"),
    };
  }

  async verifyChain(): Promise<AuditChainVerificationResult> {
    return verifyAuditChain(await this.store.readGlobalChain());
  }
}
