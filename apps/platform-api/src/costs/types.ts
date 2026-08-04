import type { CostSource, EstimateCostResponse } from "../engine";

export interface CostSummary {
  readonly startAt: string;
  readonly endAt: string;
  readonly currency: "INR" | "USD";
  readonly dimensions: readonly string[];
  readonly groups: readonly CostSummaryGroup[];
  readonly totals: CostSummaryTotals;
}

export interface CostSummaryGroup {
  readonly dimensions: Readonly<Record<string, string>>;
  readonly internalCostMinor: string;
  readonly retryCostMinor: string;
  readonly recoveryCostMinor: string;
  readonly billableMinor: string;
  readonly marginMinor: string;
  readonly eventCount: number;
}

export interface CostSummaryTotals {
  readonly internalCostMinor: string;
  readonly billableMinor: string;
  readonly marginMinor: string;
}

export interface EstimateCostInput {
  readonly mode: "workflow" | "project";
  readonly lineItems: readonly EstimateCostLineItem[];
}

export interface EstimateCostLineItem {
  readonly source: CostSource;
  readonly provider: string;
  readonly resource: string;
  readonly expectedQuantity: number;
}

export type CostEstimate = EstimateCostResponse;
