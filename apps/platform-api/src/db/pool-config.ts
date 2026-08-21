import { z } from "zod";

/**
 * ENGINE-FIX-P3-6. Every one of platform-api's 29 `new Pool(...)`
 * construction sites passed only `connectionString` -- no `max`, no
 * `idleTimeoutMillis`, no `connectionTimeoutMillis`, no
 * `statement_timeout`. node-postgres defaults `max` to 10 per pool; 29
 * separate pools meant up to 290 connections from a single instance
 * against Postgres's default `max_connections` of 100, and with no
 * `connectionTimeoutMillis` a saturated pool hangs requests indefinitely
 * rather than failing fast.
 *
 * One config, shared by every pool this app constructs (see db.module.ts)
 * -- there's no reason platform_db, marketplace_db and the two optional
 * operations replicas would each need a different size policy today, and
 * adding four sets of near-identical env vars for a distinction nothing
 * currently needs would be its own kind of clutter.
 */
const poolSizeSchema = z.object({
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DATABASE_POOL_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export interface PoolSizeConfig {
  readonly max: number;
  readonly idleTimeoutMillis: number;
  readonly connectionTimeoutMillis: number;
  readonly statement_timeout: number;
}

export function poolSizeConfigFromEnvironment(
  environment: NodeJS.ProcessEnv,
): PoolSizeConfig {
  const parsed = poolSizeSchema.safeParse(environment);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid database pool size environment: ${detail}`);
  }
  return {
    max: parsed.data.DATABASE_POOL_MAX,
    idleTimeoutMillis: parsed.data.DATABASE_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: parsed.data.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    statement_timeout: parsed.data.DATABASE_POOL_STATEMENT_TIMEOUT_MS,
  };
}
