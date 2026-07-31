import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist/apps/cost-ledger-service");

await mkdir(output, { recursive: true });
await cp(
  resolve(root, "apps/cost-ledger-service/drizzle"),
  resolve(output, "drizzle"),
  { recursive: true, force: true },
);
