import { defineConfig } from "drizzle-kit";

// Migrations normally run at service startup via the store provider's own
// migrate(). This config exists so they can also be applied directly, without
// booting the service and its full runtime configuration -- which local
// bootstrap needs, and which docs/local-dev.md previously had no way to do.
const url = process.env.AUDIT_DATABASE_URL;

if (!url) {
  throw new Error(
    "AUDIT_DATABASE_URL is required, e.g. postgresql://audit_service:<password>@localhost:5433/audit_db",
  );
}

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  dbCredentials: { url },
});
