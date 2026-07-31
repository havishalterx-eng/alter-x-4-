import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspacePath = resolve(
  process.cwd(),
  "apps/cost-ledger-service/drizzle",
);

export const COST_MIGRATIONS_PATH = existsSync(workspacePath)
  ? workspacePath
  : resolve(__dirname, "../drizzle");
