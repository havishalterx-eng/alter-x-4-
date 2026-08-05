import { Injectable } from "@nestjs/common";
import { decodeSearchCursor, encodeSearchCursor } from "./cursor";
import { MarketplaceSearchRepository } from "./search.repository";
import type { SearchPage, SearchQuery } from "./types";

@Injectable()
export class MarketplaceSearchService {
  constructor(private readonly repository: MarketplaceSearchRepository) {}
  async search(tenantId: string, query: SearchQuery): Promise<SearchPage> {
    const cursor = decodeSearchCursor(query.cursor, query, "/api/v1/search");
    const rows = await this.repository.search(tenantId, query, cursor);
    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit);
    const last = data.at(-1);
    return { data, page: { has_more: hasMore, next_cursor: hasMore && last ? encodeSearchCursor(query, last) : null, limit: query.limit } };
  }
}
