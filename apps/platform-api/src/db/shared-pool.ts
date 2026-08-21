import { Pool } from "pg";
import { poolSizeConfigFromEnvironment } from "./pool-config";

const pools = new Map<string, Pool>();

/**
 * ENGINE-FIX-P3-6. Returns the same configured Pool for a given
 * connectionString across every call in this process. Was: 29
 * unconfigured `new Pool({ connectionString })` sites across 24 modules,
 * most pointed at the same database, no max/timeouts on any of them --
 * up to 290 connections from a single instance against Postgres's
 * default `max_connections` of 100.
 *
 * Deliberately a plain module-level cache, not a NestJS DI provider: an
 * earlier version of this fix put the pool behind a @Global() DI token,
 * which broke ~30 existing spec files that construct one feature module
 * in isolation via `Test.createTestingModule({ imports: [XModule] })`
 * without ever importing the module that would provide the token. This
 * function takes no injected dependencies, so every one of those existing
 * tests keeps working unmodified -- same as `new Pool(...)` did before,
 * just returning a shared, configured instance instead of a fresh
 * unconfigured one every time.
 */
export function sharedPool(connectionString: string | undefined): Pool {
  const key = connectionString ?? "";
  const existing = pools.get(key);
  if (existing) return existing;
  const size = poolSizeConfigFromEnvironment(process.env);
  const pool = new Pool({ connectionString, ...size });
  pools.set(key, pool);
  return pool;
}
