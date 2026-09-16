import pg from "pg";
import {
  applyMarketplaceMigrations,
  type MigrationDirection,
} from "../src/db/marketplace-migrator";

// MARKETPLACE_DATABASE_URL is its own variable even though it points at the
// same database as DATABASE_URL by default -- the marketplace schema is
// separable, so the runner honours it rather than reusing the platform URL.
function databaseUrl(): string {
  const url = process.env.MARKETPLACE_DATABASE_URL?.trim();
  if (url === undefined || url.length === 0) {
    throw new Error("MARKETPLACE_DATABASE_URL is required");
  }
  return url;
}

function direction(argument: string | undefined): MigrationDirection {
  if (argument === undefined || argument === "up") {
    return "up";
  }
  if (argument === "down") {
    return "down";
  }
  throw new Error(`unknown direction "${argument}" (expected up or down)`);
}

async function main(): Promise<void> {
  const requested = direction(process.argv[2]);
  const steps = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
  if (steps !== undefined && !Number.isInteger(steps)) {
    throw new Error(`steps must be a whole number, got "${process.argv[3]}"`);
  }

  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    // exactOptionalPropertyTypes is on, so an absent step count has to be an
    // absent property rather than an explicit undefined.
    const changed = await applyMarketplaceMigrations(
      client,
      steps === undefined
        ? { direction: requested }
        : { direction: requested, steps },
    );
    if (changed.length === 0) {
      console.log(
        requested === "up"
          ? "marketplace migrations: already up to date"
          : "marketplace migrations: nothing to unwind",
      );
      return;
    }
    const verb = requested === "up" ? "applied" : "unwound";
    console.log(`marketplace migrations ${verb}: ${changed.join(", ")}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    `marketplace migrations failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
