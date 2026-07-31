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
await mkdir(resolve(output, "proto"), { recursive: true });
await cp(
  resolve(root, "packages/contracts/proto/alter/cost/v1/cost.proto"),
  resolve(output, "proto/cost.proto"),
  { force: true },
);
await cp(
  resolve(root, "packages/contracts/proto/alter/runs/v1/runs.proto"),
  resolve(output, "proto/runs.proto"),
  { force: true },
);
