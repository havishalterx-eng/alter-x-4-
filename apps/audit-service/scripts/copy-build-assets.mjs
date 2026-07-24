import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist/apps/audit-service");

await mkdir(resolve(output, "proto"), { recursive: true });
await cp(
  resolve(root, "apps/audit-service/drizzle"),
  resolve(output, "drizzle"),
  { recursive: true, force: true },
);
await cp(
  resolve(root, "packages/contracts/proto/alter/audit/v1/audit.proto"),
  resolve(output, "proto/audit.proto"),
  { force: true },
);
