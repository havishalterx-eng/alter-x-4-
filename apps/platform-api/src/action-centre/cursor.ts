import { ActionCentreHttpError } from "./problem";
import type { ActionQueueQuery } from "./types";

interface QueueCursor {
  version: 1;
  approval_cursor: string | null;
  escalation_cursor: string | null;
  approval_done: boolean;
  escalation_done: boolean;
  offset: number;
  limit: number;
  type: ActionQueueQuery["type"] | null;
  status: ActionQueueQuery["status"] | null;
}

export function initialCursor(query: ActionQueueQuery): QueueCursor {
  return {
    version: 1,
    approval_cursor: null,
    escalation_cursor: null,
    approval_done: false,
    escalation_done: false,
    offset: 0,
    limit: query.limit ?? 50,
    type: query.type ?? null,
    status: query.status ?? null,
  };
}

export function decodeCursor(
  encoded: string,
  query: ActionQueueQuery,
  instance: string,
): QueueCursor {
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<QueueCursor>;
    if (
      value.version !== 1 ||
      !validNullableString(value.approval_cursor) ||
      !validNullableString(value.escalation_cursor) ||
      typeof value.approval_done !== "boolean" ||
      typeof value.escalation_done !== "boolean" ||
      !Number.isSafeInteger(value.offset) ||
      value.offset! < 0 ||
      !Number.isSafeInteger(value.limit) ||
      value.limit! < 1 ||
      value.limit! > 200 ||
      !validType(value.type) ||
      !validStatus(value.status) ||
      (query.limit !== undefined && query.limit !== value.limit) ||
      (query.type !== undefined && query.type !== value.type) ||
      (query.status !== undefined && query.status !== value.status)
    ) {
      throw new Error("invalid");
    }
    return value as QueueCursor;
  } catch {
    throw new ActionCentreHttpError(
      400,
      "INVALID_ACTION_CENTRE_REQUEST",
      "Human Action Centre request validation failed",
      instance,
      [{ field: "cursor", message: "Invalid or mismatched queue cursor" }],
    );
  }
}

export function encodeCursor(cursor: QueueCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function advanceWithinBatch(
  cursor: QueueCursor,
  offset: number,
): QueueCursor {
  return { ...cursor, offset };
}

export function advanceBatch(
  cursor: QueueCursor,
  approval: { next_cursor: string | null; has_more: boolean } | undefined,
  escalation: { next_cursor: string | null; has_more: boolean } | undefined,
): QueueCursor {
  return {
    ...cursor,
    approval_cursor: approval?.next_cursor ?? cursor.approval_cursor,
    escalation_cursor: escalation?.next_cursor ?? cursor.escalation_cursor,
    approval_done: approval ? !approval.has_more : cursor.approval_done,
    escalation_done: escalation ? !escalation.has_more : cursor.escalation_done,
    offset: 0,
  };
}

export type { QueueCursor };

function validNullableString(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length > 0);
}

function validType(value: unknown): boolean {
  return value === null || value === "approval" || value === "escalation";
}

function validStatus(value: unknown): boolean {
  return value === null || value === "pending";
}
