import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { FeatureFlag } from "@alterx/contracts";
import type { Pool } from "pg";

interface FlagRow {
  name: string;
  enabled: boolean;
  description: string;
  revision: number;
  updated_at: Date;
  updated_by: string;
}

@Injectable()
export class FeatureFlagRepository implements OnModuleDestroy {
  constructor(private readonly pool: Pool, private readonly closePoolOnDestroy = false) {}

  async list(): Promise<FeatureFlag[]> {
    const result = await this.pool.query<FlagRow>(
      `SELECT name, enabled, description, revision, updated_at, updated_by
       FROM feature_flags ORDER BY name`,
    );
    return result.rows.map(mapRow);
  }

  async upsert(
    name: string,
    enabled: boolean,
    description: string,
    staffUserId: string,
  ): Promise<FeatureFlag> {
    const result = await this.pool.query<FlagRow>(
      `INSERT INTO feature_flags (name, enabled, description, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         description = EXCLUDED.description,
         revision = feature_flags.revision + 1,
         updated_at = clock_timestamp(),
         updated_by = EXCLUDED.updated_by
       RETURNING name, enabled, description, revision, updated_at, updated_by`,
      [name, enabled, description, staffUserId],
    );
    return mapRow(result.rows[0]!);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closePoolOnDestroy) await this.pool.end();
  }
}

function mapRow(row: FlagRow): FeatureFlag {
  return {
    name: row.name,
    enabled: row.enabled,
    description: row.description,
    revision: row.revision,
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  };
}
