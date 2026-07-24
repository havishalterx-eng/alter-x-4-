import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspacePath = resolve(
  process.cwd(),
  "apps/orchestration-service/drizzle",
);

export const ORCHESTRATION_MIGRATIONS_PATH = existsSync(workspacePath)
  ? workspacePath
  : resolve(__dirname, "../drizzle");
