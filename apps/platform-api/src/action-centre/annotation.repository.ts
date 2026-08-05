import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

export type ActionItemType = "approval" | "clarification" | "escalation";

export interface ActionItemAnnotation {
  readonly id: string;
  readonly item_type: ActionItemType;
  readonly item_id: string;
  readonly note: string;
  readonly created_by: string;
  readonly created_at: string;
}

@Injectable()
export class AnnotationRepository implements OnModuleDestroy {
  constructor(private readonly pool: Pool, private readonly closePoolOnDestroy = false) {}

  async create(
    tenantId: string,
    itemType: ActionItemType,
    itemId: string,
    note: string,
    createdBy: string,
  ): Promise<ActionItemAnnotation> {
    return this.withTenant(tenantId, async (client) => {
      const id = `ain_${randomUUID()}`;
      const result = await client.query<ActionItemAnnotation>(
        "INSERT INTO action_item_annotations (id, tenant_id, item_type, item_id, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,item_type,item_id,note,created_by,created_at::text",
        [id, tenantId, itemType, itemId, note, createdBy],
      );
      return result.rows[0]!;
    });
  }

  async list(
    tenantId: string,
    itemType: ActionItemType,
    itemId: string,
  ): Promise<readonly ActionItemAnnotation[]> {
    return this.withTenant(tenantId, async (client) =>
      (
        await client.query<ActionItemAnnotation>(
          "SELECT id,item_type,item_id,note,created_by,created_at::text FROM action_item_annotations WHERE tenant_id=$1 AND item_type=$2 AND item_id=$3 ORDER BY created_at ASC,id ASC",
          [tenantId, itemType, itemId],
        )
      ).rows,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closePoolOnDestroy) await this.pool.end();
  }

  private async withTenant<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id',$1,true)", [
        tenantId,
      ]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
