import type { CostIngestCostEventRequest } from "@alterx/contracts";
import type { JsonValue } from "@alterx/shared-clients";

const REQUIRED_STRING_FIELDS = [
  "tenant_id",
  "cost_event_id",
  "run_id",
  "node_execution_id",
  "provider_reference",
  "usage_json",
  "amount_json",
  "source",
  "occurred_at",
] as const;

/**
 * The cost-events queue message is untrusted at this boundary (published by
 * three separate services) -- returns undefined for anything that isn't a
 * real CostIngestCostEventRequest-shaped object rather than forwarding a
 * malformed request to CostIngestService (which does its own deeper
 * per-field schema validation; this is only a structural pre-check so the
 * consumer can tell "malformed" apart from "the RPC call itself failed").
 */
export function parseCostEventMessage(
  raw: JsonValue,
): CostIngestCostEventRequest | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof record[field] !== "string") {
      return undefined;
    }
  }
  return {
    tenant_id: record["tenant_id"] as string,
    cost_event_id: record["cost_event_id"] as string,
    run_id: record["run_id"] as string,
    node_execution_id: record["node_execution_id"] as string,
    provider_reference: record["provider_reference"] as string,
    usage_json: record["usage_json"] as string,
    amount_json: record["amount_json"] as string,
    source: record["source"] as string,
    occurred_at: record["occurred_at"] as string,
  };
}
