import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { SearchQuery, SearchResult } from "./types";

interface Row { kind: "listing" | "tool"; id: string; name: string; description: string | null; rank: number; type: "workflow_template" | "project_template" | "agent" | null; ecosystem: "npm" | "pip" | "mcp" | null; trust_level: string | null; }

@Injectable()
export class MarketplaceSearchRepository implements OnModuleDestroy {
  constructor(private readonly pool: Pool, private readonly closePoolOnDestroy = false) {}

  search(tenantId: string, query: SearchQuery, after?: { rank: number; id: string; resultKind: string }): Promise<SearchResult[]> {
    return this.withTenant(tenantId, async (client) => {
      const values: unknown[] = [query.q, query.kind ?? null, query.type ?? null, after?.rank ?? null, after?.id ?? null, after?.resultKind ?? null, query.limit + 1];
      const result = await client.query<Row>(`WITH search_query AS (SELECT websearch_to_tsquery('simple', $1) AS value), candidates AS (
        SELECT 'listing'::text AS kind, l.id, l.name, l.description,
          (ts_rank(l.search_document, q.value) * 10 + similarity(l.name, $1))::float8 AS rank,
          l.type, NULL::text AS ecosystem, NULL::text AS trust_level
        FROM listings l CROSS JOIN search_query q
        WHERE l.status = 'published' AND ($2::text IS NULL OR $2 = 'listing') AND ($3::text IS NULL OR l.type = $3)
          AND (l.search_document @@ q.value OR l.name % $1)
        UNION ALL
        SELECT 'tool'::text, t.id, t.name, t.description,
          (ts_rank(t.search_document, q.value) * 10 + similarity(t.name, $1))::float8,
          NULL::text, t.ecosystem, t.trust_level
        FROM tool_manifests t CROSS JOIN search_query q
        WHERE t.status = 'published' AND t.trust_level <> 'blocked' AND ($2::text IS NULL OR $2 = 'tool')
          AND (t.search_document @@ q.value OR t.name % $1)
      ) SELECT * FROM candidates
        WHERE ($4::float8 IS NULL OR rank < $4
          OR (rank = $4 AND (kind > $6 OR (kind = $6 AND id > $5))))
        ORDER BY rank DESC, kind ASC, id ASC LIMIT $7`, values);
      return result.rows.map((row) => ({ kind: row.kind, id: row.id, name: row.name, description: row.description, rank: row.rank, ...(row.type ? { type: row.type } : {}), ...(row.ecosystem ? { ecosystem: row.ecosystem, trust_level: row.trust_level! } : {}) }));
    });
  }

  async onModuleDestroy(): Promise<void> { if (this.closePoolOnDestroy) await this.pool.end(); }
  private async withTenant<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]); const value = await operation(client); await client.query("COMMIT"); return value; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
