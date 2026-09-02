import { defineConfig } from "drizzle-kit";

// Migrations normally run at service startup via the store provider's own
// migrate(). This config exists so they can also be applied directly, without
// booting the service and its full runtime configuration -- which local
// bootstrap needs, and which docs/local-dev.md previously had no way to do.
const url = process.env.COST_DATABASE_URL;

if (!url) {
  throw new Error(
    "COST_DATABASE_URL is required, e.g. postgresql://cost_ledger_service:<password>@localhost:5435/cost_db",
  );
}

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  dbCredentials: { url },
});
