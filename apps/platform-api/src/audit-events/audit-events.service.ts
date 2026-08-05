import { Injectable } from "@nestjs/common";
import {
  AuditEventsClient,
  type AuditEventsPage,
  type AuditEventsQuery,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import { AuditEventsHttpError } from "./problem";

const customerActorTypes = ["user", "service", "support"] as const;
const staffActorTypes = ["user", "service", "admin", "support", "system"] as const;
const results = ["success", "denied", "error"] as const;

@Injectable()
export class AuditEventsService {
  constructor(private readonly auditEvents: AuditEventsClient) {}

  customer(query: unknown, actor: ActorContext | undefined): Promise<AuditEventsPage> {
    const instance = "/api/v1/audit-events";
    const caller = requireActor(actor, instance);
    const parsed = parseQuery(customerQuery(query), instance);
    // Deliberately ignore client tenant_id and actor_types. Audit service's
    // internal endpoint is cross-tenant capable, so this boundary is enforced
    // here with the authenticated actor and the complete safe actor allowlist.
    return this.auditEvents.query({
      ...parsed,
      tenantId: caller.tenant_id,
      actorTypes: customerActorTypes,
    });
  }

  staff(query: unknown): Promise<AuditEventsPage> {
    return this.auditEvents.query(parseQuery(query, "/api/v1/admin/audit-events"));
  }
}

function parseQuery(value: unknown, instance: string): AuditEventsQuery {
  if (!isRecord(value)) throw invalidQuery(instance, "Query parameters must be an object");
  const allowed = new Set([
    "tenant_id", "actor_types", "action", "result", "occurred_after", "occurred_before", "cursor", "limit",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidQuery(instance, "Unsupported audit event query parameter");
  }

  const tenantId = optionalString(value.tenant_id, "tenant_id", instance);
  const requestedTypes = optionalString(value.actor_types, "actor_types", instance);
  const actorTypes = requestedTypes === undefined
    ? undefined
    : parseActorTypes(requestedTypes, instance);
  const result = optionalString(value.result, "result", instance);
  if (result !== undefined && !results.includes(result as (typeof results)[number])) {
    throw invalidQuery(instance, "result is unsupported");
  }
  const limit = parseLimit(value.limit, instance);
  const action = optionalString(value.action, "action", instance);
  const occurredAfter = optionalString(value.occurred_after, "occurred_after", instance);
  const occurredBefore = optionalString(value.occurred_before, "occurred_before", instance);
  const cursor = optionalString(value.cursor, "cursor", instance);
  return {
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(actorTypes === undefined ? {} : { actorTypes }),
    ...(action === undefined ? {} : { action }),
    ...(result === undefined ? {} : { result: result as (typeof results)[number] }),
    ...(occurredAfter === undefined ? {} : { occurredAfter }),
    ...(occurredBefore === undefined ? {} : { occurredBefore }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function parseActorTypes(
  raw: string,
  instance: string,
): readonly (typeof staffActorTypes)[number][] {
  const types = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (types.length === 0 || types.some((value) => !staffActorTypes.includes(value as (typeof staffActorTypes)[number]))) {
    throw invalidQuery(instance, "actor_types contains an unsupported value");
  }
  return types as readonly (typeof staffActorTypes)[number][];
}

function customerQuery(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "tenant_id" && key !== "actor_types"),
  );
}

function optionalString(value: unknown, field: string, instance: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw invalidQuery(instance, `${field} must be a non-empty string up to 512 bytes`);
  }
  return value;
}

function parseLimit(value: unknown, instance: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw invalidQuery(instance, "limit must be an integer from 1 to 200");
  }
  return parsed;
}

function requireActor(actor: ActorContext | undefined, instance: string): ActorContext {
  if (!actor) {
    throw new AuditEventsHttpError(401, "AUTHENTICATION_REQUIRED", "Authenticated actor required", instance);
  }
  return actor;
}

function invalidQuery(instance: string, detail: string): AuditEventsHttpError {
  return new AuditEventsHttpError(400, "INVALID_AUDIT_EVENTS_QUERY", detail, instance);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
