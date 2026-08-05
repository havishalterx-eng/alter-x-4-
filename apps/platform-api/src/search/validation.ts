import { z } from "zod";
import { SearchHttpError } from "./problem";
import { searchKinds, searchableListingTypes, type SearchQuery } from "./types";

export function parseSearchQuery(query: Record<string, string | undefined>, instance: string): SearchQuery {
  const result = z.object({
    q: z.string().trim().min(1).max(500),
    kind: z.enum(searchKinds).optional(),
    type: z.enum(searchableListingTypes).optional(),
    limit: z.coerce.number().int().min(1).default(50),
    cursor: z.string().min(1).max(2048).optional(),
  }).strict().safeParse(query);
  if (!result.success) throw new SearchHttpError(instance, "Search request validation failed", result.error.issues[0]?.path.join(".") || "query");
  if (result.data.type && result.data.kind !== "listing") throw new SearchHttpError(instance, "type is only valid when kind=listing", "type");
  return {
    q: result.data.q,
    limit: Math.min(result.data.limit, 200),
    ...(result.data.kind === undefined ? {} : { kind: result.data.kind }),
    ...(result.data.type === undefined ? {} : { type: result.data.type }),
    ...(result.data.cursor === undefined ? {} : { cursor: result.data.cursor }),
  };
}
