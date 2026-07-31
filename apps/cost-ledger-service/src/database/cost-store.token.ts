import type { PostgresCostStoreProvider } from "@alterx/adapters";

/**
 * Local DI token -- no shared-clients `COST_STORE_PROVIDER` constant exists
 * yet (cost-ledger-service has no other consumer to share it with beyond
 * this one, first, OUT-6 module). If a second real consumer needs this
 * store, promote this token into `packages/shared-clients` at that point
 * rather than duplicating it, following the same pattern
 * `AUDIT_STORE_PROVIDER` already establishes there.
 */
export const COST_STORE_PROVIDER = Symbol("COST_STORE_PROVIDER");

export type CostStoreProvider = PostgresCostStoreProvider;
