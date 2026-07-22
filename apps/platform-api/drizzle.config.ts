import { defineConfig } from "drizzle-kit";
import { validatePlatformApiEnv } from "./src/config/env.schema";

const env = validatePlatformApiEnv(process.env);

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
