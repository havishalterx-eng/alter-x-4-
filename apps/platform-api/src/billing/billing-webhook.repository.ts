import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { JsonValue } from "@alterx/shared-clients";
import type { Pool, PoolClient } from "pg";
import type { EntitlementAccessState } from "../entitlements";

export interface DunningStateRecord {
  state: EntitlementAccessState;
  currentPlan: string | null;
  firstFailedAt: Date | null;
}

@Injectable()
export class BillingWebhookRepository implements OnModuleDestroy {
  constructor(
    private readonly pool: Pool,
    private readonly closePoolOnDestroy = false,
  ) {}

  async transaction<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [tenantId],
      );
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

  async insertEvent(
    client: PoolClient,
    input: {
      tenantId: string;
      providerId: string;
      providerEventId: string;
      type: string;
      payload: JsonValue;
    },
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO billing_events
         (tenant_id, provider_id, provider_event_id, type, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (provider_event_id) DO NOTHING`,
      [
        input.tenantId,
        input.providerId,
        input.providerEventId,
        input.type,
        JSON.stringify(input.payload),
      ],
    );
    return result.rowCount === 1;
  }

  async markEventProcessed(
    client: PoolClient,
    tenantId: string,
    providerEventId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE billing_events
          SET processed_at = clock_timestamp()
        WHERE tenant_id = $1 AND provider_event_id = $2`,
      [tenantId, providerEventId],
    );
  }

  async getDunningState(
    client: PoolClient,
    tenantId: string,
  ): Promise<DunningStateRecord> {
    const result = await client.query<{
      state: EntitlementAccessState;
      current_plan: string | null;
      first_failed_at: Date | null;
    }>(
      `SELECT state, current_plan, first_failed_at
         FROM billing_dunning_states
        WHERE tenant_id = $1
        FOR UPDATE`,
      [tenantId],
    );
    const row = result.rows[0];
    if (row) {
      return {
        state: row.state,
        currentPlan: row.current_plan,
        firstFailedAt: row.first_failed_at,
      };
    }
    const profile = await client.query<{ current_plan: string | null }>(
      `SELECT current_plan FROM billing_profiles WHERE tenant_id = $1`,
      [tenantId],
    );
    return {
      state: "active",
      currentPlan: profile.rows[0]?.current_plan ?? null,
      firstFailedAt: null,
    };
  }

  async saveDunningState(
    client: PoolClient,
    tenantId: string,
    state: DunningStateRecord,
  ): Promise<void> {
    await client.query(
      `INSERT INTO billing_dunning_states
         (tenant_id, state, current_plan, first_failed_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE
         SET state = EXCLUDED.state,
             current_plan = EXCLUDED.current_plan,
             first_failed_at = EXCLUDED.first_failed_at,
             updated_at = clock_timestamp()`,
      [tenantId, state.state, state.currentPlan, state.firstFailedAt],
    );
  }

  async auditTransition(
    client: PoolClient,
    input: {
      tenantId: string;
      providerEventId: string;
      fromState: EntitlementAccessState;
      toState: EntitlementAccessState;
      reason: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO billing_dunning_audits
         (tenant_id, id, provider_event_id, from_state, to_state, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.tenantId,
        randomUUID(),
        input.providerEventId,
        input.fromState,
        input.toState,
        input.reason,
      ],
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closePoolOnDestroy) await this.pool.end();
  }
}
