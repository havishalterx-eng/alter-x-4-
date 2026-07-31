/**
 * OUT-6: pre-execution cost estimation. No formal request/response shape
 * exists in doc 05 (API spec) or doc 04 (data model) for this endpoint --
 * genuinely new design, disclosed in the PR. Real, deliberate choices:
 *
 * - Callers supply the planned cost-driving line items directly (source/
 *   provider/resource/expected_quantity) rather than this service parsing
 *   a compiled DAG itself -- keeps cost-ledger-service decoupled from
 *   orchestration_db's DAG shape (no cross-database join, doc 04 SS1), the
 *   caller (whichever service starts a run) already has the compiled DAG
 *   and can derive these line items from it.
 * - Only `internal_cost_minor` is estimated -- `billable_minor`/
 *   `margin_minor` need OUT-5's pricing/margin model, which doesn't exist
 *   yet. Disclosed known gap, not silently omitted.
 */

export const COST_SOURCES = [
  "model_gateway",
  "tool_gateway",
  "sandbox",
  "storage",
  "browser",
] as const;
export type CostSource = (typeof COST_SOURCES)[number];

export const COST_MODES = ["workflow", "project"] as const;
export type CostMode = (typeof COST_MODES)[number];

export interface EstimateLineItemRequest {
  readonly source: CostSource;
  readonly provider: string;
  readonly resource: string;
  readonly expectedQuantity: number;
}

export interface EstimateCostRequest {
  readonly tenantId: string;
  readonly mode: CostMode;
  readonly lineItems: readonly EstimateLineItemRequest[];
}

export type EstimateConfidence =
  | "tenant_historical"
  | "global_historical"
  | "no_data";

export interface EstimateLineItemResult {
  readonly source: CostSource;
  readonly provider: string;
  readonly resource: string;
  readonly expectedQuantity: number;
  readonly confidence: EstimateConfidence;
  /** Sample size backing the historical average -- 0 when confidence is "no_data". */
  readonly sampleSize: number;
  readonly historicalUnitCostMinor: string | null;
  readonly estimatedBaseCostMinor: string;
  readonly historicalRetryRate: number;
  readonly estimatedRetryCostMinor: string;
  readonly estimatedTotalCostMinor: string;
}

export interface EstimateCostResponse {
  readonly currency: "INR";
  readonly lineItems: readonly EstimateLineItemResult[];
  readonly totalEstimatedInternalCostMinor: string;
  /** True when at least one line item had zero historical data anywhere (tenant or global). */
  readonly hasUnestimatedLineItems: boolean;
}
