import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";

/**
 * Real, disclosed eval-only migration runner -- applies orchestration-
 * service's real drizzle migrations to a target Postgres and exits, no
 * server. Used by cross-service eval fixtures (e.g. verification-
 * service's AssessSeverity, which reads orchestration-service's own
 * `runs`/`node_executions`/`workflow_versions` tables directly) that
 * need the real schema present but don't need orchestration-service's
 * own process running.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.EVAL_MIGRATE_DB_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("eval_migrate_only requires EVAL_MIGRATE_DB_URL");
  }
  const store = new PostgresOrchestrationStoreProvider({
    authentication: "static",
    connectionString: databaseUrl,
    migrationsFolder: `${__dirname}/drizzle`,
  });
  await store.migrate();
}

void main();
