import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import {
  IsoTimestampSchema,
  NodeExecutionIdSchema,
  RunIdSchema,
  TenantIdSchema,
} from "@alterx/contracts";

import { COST_STORE_PROVIDER, type CostStoreProvider } from "../database/cost-store.token";
import type {
  CostRecordModelOutcomeRequest,
  CostRecordModelOutcomeResponse,
} from "@alterx/contracts";

export class ModelOutcomesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelOutcomesValidationError";
  }
}

const VERDICTS = new Set(["success", "failure", "partial", "escalated"]);

export interface ModelOutcomeObservation {
  readonly verdict: string;
  readonly recordedAt: string;
}

function requireSchema(
  schema: { safeParse: (value: string) => { success: boolean } },
  value: string,
  field: string,
): string {
  if (!schema.safeParse(value).success) {
    throw new ModelOutcomesValidationError(`Invalid ${field}: ${value}`);
  }
  return value;
}

// run_id/node_execution_id are optional on this RPC ("empty if not
// applicable", cost.proto) -- unlike ingestCostEvent's always-required
// versions, an empty string here means "no linked run", not an invalid one.
function optionalBareId(
  schema: { safeParse: (value: string) => { success: boolean } },
  value: string,
  prefix: string,
  field: string,
): string | null {
  if (value === "") {
    return null;
  }
  return requireSchema(schema, value, field).slice(prefix.length);
}

function bareTenantUuid(tenantId: string): string {
  return tenantId.slice("ten_".length);
}

@Injectable()
export class ModelOutcomesService {
  constructor(
    @Inject(COST_STORE_PROVIDER)
    private readonly store: CostStoreProvider,
  ) {}

  async recordOutcome(
    request: CostRecordModelOutcomeRequest,
  ): Promise<CostRecordModelOutcomeResponse> {
    const tenantId = requireSchema(TenantIdSchema, request.tenant_id, "tenant_id");
    if (!request.provider || !request.resource) {
      throw new ModelOutcomesValidationError("provider and resource are required");
    }
    if (!VERDICTS.has(request.verdict)) {
      throw new ModelOutcomesValidationError(
        `verdict must be one of success, failure, partial, escalated -- got "${request.verdict}"`,
      );
    }
    const recordedAt = requireSchema(IsoTimestampSchema, request.recorded_at, "recorded_at");
    const runId = optionalBareId(RunIdSchema, request.run_id, "run_", "run_id");
    const nodeExecutionId = optionalBareId(
      NodeExecutionIdSchema,
      request.node_execution_id,
      "node_",
      "node_execution_id",
    );

    await this.store.withTenant(bareTenantUuid(tenantId), async (tx) => {
      await tx.query(
        `INSERT INTO model_outcomes
           (id, tenant_id, provider, resource, verdict, run_id, node_execution_id, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          bareTenantUuid(tenantId),
          request.provider,
          request.resource,
          request.verdict,
          runId,
          nodeExecutionId,
          recordedAt,
        ],
      );
    });

    return { accepted: true };
  }

  /**
   * Real, cross-tenant, unaggregated observations -- the caller (Drift
   * Detector) computes the windowed failure-rate delta itself, mirroring the
   * same division of responsibility already established for agent drift
   * (IntelligencePerformanceClient also returns raw observations, not a
   * pre-computed rate). Runs under the BYPASSRLS cost_ledger_provisioner
   * role deliberately -- real model/provider health is a platform-wide
   * signal, not a per-tenant one, matching the same cross-tenant precedent
   * EstimationService's own global-historical-average fallback already
   * uses.
   */
  async queryWindow(
    provider: string,
    resource: string | undefined,
    limit: number,
  ): Promise<readonly ModelOutcomeObservation[]> {
    if (!provider) {
      throw new ModelOutcomesValidationError("provider is required");
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new ModelOutcomesValidationError("limit must be a positive integer");
    }

    const rows = await this.store.withProvisioner(async (tx) => {
      // Deliberately not cast to ::text (unlike this repo's usual
      // convention elsewhere): the real consumer is memory-service's
      // Python Drift Detector, and Postgres's native ::text rendering of
      // timestamptz (2-digit UTC offset, no "T" separator) fails Pydantic
      // v2 datetime validation. Left as a real driver-parsed JS Date and
      // formatted via toISOString() below instead, which is unambiguous
      // RFC 3339 both languages agree on.
      const result = resource
        ? await tx.query<{ verdict: string; recorded_at: Date }>(
            `SELECT verdict, recorded_at FROM model_outcomes
             WHERE provider = $1 AND resource = $2
             ORDER BY recorded_at DESC LIMIT $3`,
            [provider, resource, limit],
          )
        : await tx.query<{ verdict: string; recorded_at: Date }>(
            `SELECT verdict, recorded_at FROM model_outcomes
             WHERE provider = $1
             ORDER BY recorded_at DESC LIMIT $2`,
            [provider, limit],
          );
      return result.rows;
    });

    return rows.map((row) => ({
      verdict: row.verdict,
      recordedAt: row.recorded_at.toISOString(),
    }));
  }
}
