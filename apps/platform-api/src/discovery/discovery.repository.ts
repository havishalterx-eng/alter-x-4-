import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { JsonValue } from "@alterx/shared-clients";
import type { Pool, PoolClient } from "pg";
import type {
  DiscoveryCandidate,
  DiscoveryRecommendation,
  DiscoveryRecommendationStatus,
} from "./types";

interface RecommendationRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  problem_statement: string;
  evidence_json: Record<string, JsonValue>;
  estimated_value: number;
  estimated_effort: number;
  required_integrations_json: string[];
  risk_level: "low" | "medium" | "high";
  confidence: string | number;
  status: DiscoveryRecommendationStatus;
  created_at: Date;
}

@Injectable()
export class DiscoveryRepository implements OnModuleDestroy {
  constructor(
    private readonly pool: Pool,
    private readonly closePoolOnDestroy = false,
  ) {}

  async upsertSuggested(
    tenantId: string,
    workspaceId: string,
    id: string,
    candidate: DiscoveryCandidate,
  ): Promise<void> {
    await this.withTenant(tenantId, async (client) => {
      await client.query(
        `INSERT INTO discovery_recommendations
           (id, tenant_id, workspace_id, problem_statement, evidence_json,
            estimated_value, estimated_effort, required_integrations_json,
            risk_level, confidence, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10, 'suggested')
         ON CONFLICT (tenant_id, workspace_id, problem_statement) DO UPDATE
           SET evidence_json = EXCLUDED.evidence_json,
               estimated_value = EXCLUDED.estimated_value,
               estimated_effort = EXCLUDED.estimated_effort,
               required_integrations_json = EXCLUDED.required_integrations_json,
               risk_level = EXCLUDED.risk_level,
               confidence = EXCLUDED.confidence
         WHERE discovery_recommendations.status = 'suggested'`,
        [
          id,
          tenantId,
          workspaceId,
          candidate.problemStatement,
          JSON.stringify(candidate.evidence),
          candidate.estimatedValue,
          candidate.estimatedEffort,
          JSON.stringify(candidate.requiredIntegrations),
          candidate.riskLevel,
          candidate.confidence,
        ],
      );
    });
  }

  async list(tenantId: string, workspaceId: string): Promise<DiscoveryRecommendation[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<RecommendationRow>(
        `SELECT id, tenant_id, workspace_id, problem_statement, evidence_json,
                estimated_value, estimated_effort, required_integrations_json,
                risk_level, confidence, status, created_at
           FROM discovery_recommendations
          WHERE tenant_id = $1 AND workspace_id = $2
          ORDER BY estimated_value DESC, confidence DESC, created_at DESC, id DESC`,
        [tenantId, workspaceId],
      );
      return result.rows.map(mapRow);
    });
  }

  async find(
    tenantId: string,
    workspaceId: string,
    id: string,
  ): Promise<DiscoveryRecommendation | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<RecommendationRow>(
        `SELECT id, tenant_id, workspace_id, problem_statement, evidence_json,
                estimated_value, estimated_effort, required_integrations_json,
                risk_level, confidence, status, created_at
           FROM discovery_recommendations
          WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3`,
        [tenantId, workspaceId, id],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  async accept(tenantId: string, workspaceId: string, id: string, workflowId: string): Promise<boolean> {
    return this.transition(tenantId, workspaceId, id, "accepted", workflowId);
  }

  dismiss(tenantId: string, workspaceId: string, id: string): Promise<boolean> {
    return this.transition(tenantId, workspaceId, id, "dismissed");
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closePoolOnDestroy) await this.pool.end();
  }

  private async transition(
    tenantId: string,
    workspaceId: string,
    id: string,
    status: "accepted" | "dismissed",
    workflowId?: string,
  ): Promise<boolean> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE discovery_recommendations
            SET status = $4,
                evidence_json = CASE
                  WHEN $5::text IS NULL THEN evidence_json
                  ELSE jsonb_set(evidence_json, '{created_workflow_id}', to_jsonb($5::text), true)
                END
          WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3 AND status = 'suggested'`,
        [tenantId, workspaceId, id, status, workflowId ?? null],
      );
      return result.rowCount === 1;
    });
  }

  private async withTenant<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
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

function mapRow(row: RecommendationRow): DiscoveryRecommendation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    problemStatement: row.problem_statement,
    evidence: row.evidence_json,
    estimatedValue: row.estimated_value,
    estimatedEffort: row.estimated_effort,
    requiredIntegrations: row.required_integrations_json,
    riskLevel: row.risk_level,
    confidence: Number(row.confidence),
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}
