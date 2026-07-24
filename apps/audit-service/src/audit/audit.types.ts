import type {
  AuditActorType,
  AuditEventToAppend,
  AuditResult,
} from "@alterx/shared-clients";

export const ACTOR_TYPES = [
  "user",
  "service",
  "admin",
  "support",
  "system",
] as const satisfies readonly AuditActorType[];
export const AUDIT_RESULTS = [
  "success",
  "denied",
  "error",
] as const satisfies readonly AuditResult[];

export type ValidatedAuditEvent = Omit<AuditEventToAppend, "id">;
