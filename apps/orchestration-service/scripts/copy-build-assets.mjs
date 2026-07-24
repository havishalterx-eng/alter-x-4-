import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist/apps/orchestration-service");

await mkdir(output, { recursive: true });
await cp(
  resolve(root, "apps/orchestration-service/drizzle"),
  resolve(output, "drizzle"),
  { recursive: true, force: true },
);
