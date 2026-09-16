import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientBase } from "pg";

// The marketplace schema is hand-written SQL rather than drizzle-generated, so
// drizzle-kit does not know about it (its config's `out` is src/db/migrations).
// Until this module existed the only thing that applied these files was four
// integration specs, each with its own copy of the read-split-query loop below
// -- so a normally deployed database had none of the thirteen tables and every
// marketplace, publisher, registry and search route answered 500 on a missing
// relation. See issue #171.
export const MARKETPLACE_MIGRATIONS_PATH = join(
  __dirname,
  "marketplace-migrations",
);
const ROLLBACK_PATH = join(MARKETPLACE_MIGRATIONS_PATH, "rollback");

// Created unqualified on purpose: it lands in the first schema on the caller's
// search_path. In production that is public; in the integration specs it is
// their per-test schema, which they drop with CASCADE -- so each test still
// gets a full apply and nothing leaks between them.
const LEDGER_TABLE = "marketplace_migrations";

// The same key the four specs took by hand, with the same reason: CREATE
// EXTENSION IF NOT EXISTS races on pg_extension under concurrent workers (see
// 0003_search_indexes.sql). Holding it here means every caller is covered
// rather than only the callers that remembered.
const ADVISORY_LOCK_KEY = 729312;

export type MigrationDirection = "up" | "down";

export interface ApplyOptions {
  readonly direction?: MigrationDirection;
  /** How many migrations to unwind. Ignored for "up"; defaults to all. */
  readonly steps?: number;
}

function sqlFilesIn(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function tagOf(file: string): string {
  return file.replace(/\.sql$/, "");
}

// Split on drizzle's marker where a file carries it. Files without one (the
// rollback SQL) come back as a single chunk, which Postgres runs as a
// multi-statement simple query -- the behaviour the specs already relied on.
function statementsOf(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function ensureLedger(client: ClientBase): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${LEDGER_TABLE}" (
       "tag" text PRIMARY KEY,
       "applied_at" timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

async function appliedTags(client: ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ tag: string }>(
    `SELECT "tag" FROM "${LEDGER_TABLE}" ORDER BY "tag"`,
  );
  return rows.map((row) => row.tag);
}

async function runInTransaction(
  client: ClientBase,
  statements: string[],
  ledgerWrite: () => Promise<void>,
): Promise<void> {
  await client.query("BEGIN");
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
    await ledgerWrite();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function migrateUp(client: ClientBase): Promise<string[]> {
  const applied = new Set(await appliedTags(client));
  const pending = sqlFilesIn(MARKETPLACE_MIGRATIONS_PATH).filter(
    (file) => !applied.has(tagOf(file)),
  );

  for (const file of pending) {
    const tag = tagOf(file);
    await runInTransaction(
      client,
      statementsOf(join(MARKETPLACE_MIGRATIONS_PATH, file)),
      async () => {
        await client.query(
          `INSERT INTO "${LEDGER_TABLE}" ("tag") VALUES ($1)`,
          [tag],
        );
      },
    );
  }

  return pending.map(tagOf);
}

async function migrateDown(
  client: ClientBase,
  steps: number | undefined,
): Promise<string[]> {
  const applied = (await appliedTags(client)).reverse();
  const targets =
    steps === undefined ? applied : applied.slice(0, Math.max(steps, 0));
  const rollbacks = sqlFilesIn(ROLLBACK_PATH);
  const unwound: string[] = [];

  for (const tag of targets) {
    const index = tag.slice(0, 4);
    const rollback = rollbacks.find((file) => file.startsWith(`${index}_`));
    // A migration recorded as applied with nothing to undo it is the exact
    // gap scripts/check-migration-rollback-pairing.sh now guards. Refuse
    // rather than silently leaving the ledger and the schema disagreeing.
    if (rollback === undefined) {
      throw new Error(
        `no rollback file for applied migration ${tag} (expected ${ROLLBACK_PATH}/${index}_*.sql)`,
      );
    }

    await runInTransaction(
      client,
      statementsOf(join(ROLLBACK_PATH, rollback)),
      async () => {
        await client.query(`DELETE FROM "${LEDGER_TABLE}" WHERE "tag" = $1`, [
          tag,
        ]);
      },
    );
    unwound.push(tag);
  }

  return unwound;
}

/**
 * Applies (or unwinds) the marketplace SQL migrations against `client`, and
 * returns the tags it actually changed -- empty when there was nothing to do.
 *
 * The client's search_path decides which schema is affected and where the
 * ledger lives, so callers wanting a private schema simply set it first.
 */
export async function applyMarketplaceMigrations(
  client: ClientBase,
  options: ApplyOptions = {},
): Promise<string[]> {
  const direction = options.direction ?? "up";

  await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
  try {
    await ensureLedger(client);
    return direction === "up"
      ? await migrateUp(client)
      : await migrateDown(client, options.steps);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
  }
}
