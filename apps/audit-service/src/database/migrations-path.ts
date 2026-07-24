import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspacePath = resolve(process.cwd(), "apps/audit-service/drizzle");

export const AUDIT_MIGRATIONS_PATH = existsSync(workspacePath)
  ? workspacePath
  : resolve(__dirname, "../drizzle");
