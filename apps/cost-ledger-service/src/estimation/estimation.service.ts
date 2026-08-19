import { Inject, Injectable } from "@nestjs/common";

import { COST_STORE_PROVIDER, type CostStoreProvider } from "../database/cost-store.token";
import type {
  EstimateCostRequest,
  EstimateCostResponse,
  EstimateLineItemRequest,
  EstimateLineItemResult,
} from "./estimation.models";
import type { CostResolveUnitPriceRequest, CostResolveUnitPriceResponse } from "@alterx/contracts";

interface HistoricalAverageRow {
  readonly avg_unit_cost_minor: string | null;
  readonly sample_size: string;
  readonly retry_rate: string | null;
}

const HISTORICAL_AVERAGE_QUERY = `
  SELECT
    AVG(internal_cost_minor::numeric / NULLIF(quantity, 0))::text AS avg_unit_cost_minor,
    COUNT(*)::text AS sample_size,
    AVG(CASE WHEN is_retry THEN 1.0 ELSE 0.0 END)::text AS retry_rate
  FROM cost_events
  WHERE source = $1 AND provider = $2 AND resource = $3
`;

export class EstimationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EstimationValidationError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class EstimationService {
  constructor(
    @Inject(COST_STORE_PROVIDER)
    private readonly store: CostStoreProvider,
  ) {}

  async estimate(request: EstimateCostRequest): Promise<EstimateCostResponse> {
    if (!UUID_PATTERN.test(request.tenantId)) {
      throw new EstimationValidationError("tenantId must be a UUID");
    }
    if (request.lineItems.length === 0) {
      throw new EstimationValidationError("lineItems must not be empty");
    }
    for (const item of request.lineItems) {
      if (!Number.isFinite(item.expectedQuantity) || item.expectedQuantity <= 0) {
        throw new EstimationValidationError(
          `expectedQuantity for ${item.source}/${item.provider}/${item.resource} must be a positive number`,
        );
      }
    }

    const lineItems: EstimateLineItemResult[] = [];
    let total = 0n;
    let hasUnestimatedLineItems = false;

    for (const item of request.lineItems) {
      const result = await this.#estimateLineItem(request.tenantId, item);
      lineItems.push(result);
      total += BigInt(result.estimatedTotalCostMinor);
      if (result.confidence === "no_data") {
        hasUnestimatedLineItems = true;
      }
    }

    return {
      currency: "INR",
      lineItems,
      totalEstimatedInternalCostMinor: total.toString(),
      hasUnestimatedLineItems,
    };
  }

  async #estimateLineItem(
    tenantId: string,
    item: EstimateLineItemRequest,
  ): Promise<EstimateLineItemResult> {
    const tenantAverage = await this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<HistoricalAverageRow>(HISTORICAL_AVERAGE_QUERY, [
        item.source,
        item.provider,
        item.resource,
      ]);
      return result.rows[0];
    });

    const tenantSampleSize = Number(tenantAverage?.sample_size ?? "0");
    if (tenantSampleSize > 0 && tenantAverage?.avg_unit_cost_minor !== null) {
      return this.#buildResult(item, "tenant_historical", tenantAverage!, tenantSampleSize);
    }

    // No tenant-specific history -- fall back to a cross-tenant aggregate.
    // Runs under the BYPASSRLS `cost_ledger_provisioner` role deliberately
    // (same role right-to-delete already uses, see PostgresCostStoreProvider
    // doc comment), but only ever returns a computed scalar average, never
    // raw per-tenant rows -- matches the project's existing "aggregated,
    // anonymized" precedent for cross-tenant statistics (doc 13 SS2 global
    // memory), not a tenant-isolation exception.
    const globalAverage = await this.store.withProvisioner(async (tx) => {
      const result = await tx.query<HistoricalAverageRow>(HISTORICAL_AVERAGE_QUERY, [
        item.source,
        item.provider,
        item.resource,
      ]);
      return result.rows[0];
    });

    const globalSampleSize = Number(globalAverage?.sample_size ?? "0");
    if (globalSampleSize > 0 && globalAverage?.avg_unit_cost_minor !== null) {
      return this.#buildResult(item, "global_historical", globalAverage!, globalSampleSize);
    }

    return {
      source: item.source,
      provider: item.provider,
      resource: item.resource,
      expectedQuantity: item.expectedQuantity,
      confidence: "no_data",
      sampleSize: 0,
      historicalUnitCostMinor: null,
      estimatedBaseCostMinor: "0",
      historicalRetryRate: 0,
      estimatedRetryCostMinor: "0",
      estimatedTotalCostMinor: "0",
    };
  }

  #buildResult(
    item: EstimateLineItemRequest,
    confidence: "tenant_historical" | "global_historical",
    average: HistoricalAverageRow,
    sampleSize: number,
  ): EstimateLineItemResult {
    // avg_unit_cost_minor is a decimal string (Postgres NUMERIC via AVG) --
    // round up (ceil) rather than truncate, so the estimate never
    // under-quotes a real historical cost.
    const unitCostMinor = Math.ceil(Number(average.avg_unit_cost_minor));
    const retryRate = Number(average.retry_rate ?? "0");
    const baseCostMinor = BigInt(Math.ceil(unitCostMinor * item.expectedQuantity));
    const retryCostMinor = BigInt(Math.ceil(Number(baseCostMinor) * retryRate));
    const totalCostMinor = baseCostMinor + retryCostMinor;

    return {
      source: item.source,
      provider: item.provider,
      resource: item.resource,
      expectedQuantity: item.expectedQuantity,
      confidence,
      sampleSize,
      historicalUnitCostMinor: unitCostMinor.toString(),
      estimatedBaseCostMinor: baseCostMinor.toString(),
      historicalRetryRate: retryRate,
      estimatedRetryCostMinor: retryCostMinor.toString(),
      estimatedTotalCostMinor: totalCostMinor.toString(),
    };
  }
  async resolveUnitPrice(
    request: CostResolveUnitPriceRequest,
  ): Promise<CostResolveUnitPriceResponse> {
    if (!request.provider || !request.resource) {
      throw new EstimationValidationError("provider and resource are required");
    }

    // 1. Look up fixed price table (model_pricing) using provisioner since it's global
    const fixedPrice = await this.store.withProvisioner(async (tx) => {
      const result = await tx.query<{ unit_cost_minor: string; currency: string }>(
        `SELECT unit_cost_minor::text, currency FROM model_pricing WHERE provider = $1 AND resource = $2`,
        [request.provider, request.resource]
      );
      return result.rows[0];
    });

    if (fixedPrice) {
      return {
        unit_cost_minor: fixedPrice.unit_cost_minor,
        currency: fixedPrice.currency,
        confidence: "fixed_table",
      };
    }

    // 2. Fall back to global historical average for model_gateway
    const globalAverage = await this.store.withProvisioner(async (tx) => {
      const result = await tx.query<HistoricalAverageRow>(HISTORICAL_AVERAGE_QUERY, [
        "model_gateway",
        request.provider,
        request.resource,
      ]);
      return result.rows[0];
    });

    const globalSampleSize = Number(globalAverage?.sample_size ?? "0");
    if (globalSampleSize > 0 && globalAverage?.avg_unit_cost_minor !== null) {
      const unitCostMinor = Math.ceil(Number(globalAverage.avg_unit_cost_minor));
      return {
        unit_cost_minor: unitCostMinor.toString(),
        currency: "INR",
        confidence: "global_historical",
      };
    }

    // 3. No data
    return {
      unit_cost_minor: "0",
      currency: "INR",
      confidence: "no_data",
    };
  }
}
