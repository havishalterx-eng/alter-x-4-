import { createHmac, timingSafeEqual } from "node:crypto";
import { SearchHttpError } from "./problem";
import type { SearchQuery } from "./types";

interface SearchCursor { readonly v: 1; readonly q: string; readonly kind: string | null; readonly type: string | null; readonly limit: number; readonly rank: number; readonly id: string; readonly resultKind: string; }

export function encodeSearchCursor(query: SearchQuery, result: { rank: number; id: string; kind: string }): string {
  const payload: SearchCursor = { v: 1, q: query.q, kind: query.kind ?? null, type: query.type ?? null, limit: query.limit, rank: result.rank, id: result.id, resultKind: result.kind };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSearchCursor(cursor: string | undefined, query: SearchQuery, instance: string): SearchCursor | undefined {
  if (!cursor) return undefined;
  try {
    const [body, signature, extra] = cursor.split(".");
    if (!body || !signature || extra || !safeEqual(signature, sign(body))) throw new Error("signature");
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SearchCursor>;
    if (value.v !== 1 || value.q !== query.q || value.kind !== (query.kind ?? null) || value.type !== (query.type ?? null) || value.limit !== query.limit || !Number.isFinite(value.rank) || typeof value.id !== "string" || typeof value.resultKind !== "string") throw new Error("shape");
    return value as SearchCursor;
  } catch { throw new SearchHttpError(instance, "Invalid or mismatched search cursor", "cursor"); }
}

function sign(value: string): string {
  const secret = process.env.MARKETPLACE_SEARCH_CURSOR_SECRET;
  if (!secret) throw new Error("MARKETPLACE_SEARCH_CURSOR_SECRET is required");
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
