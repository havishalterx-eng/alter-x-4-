import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist/apps/background-workers");

await mkdir(resolve(output, "proto"), { recursive: true });
await cp(
  resolve(root, "packages/contracts/proto/alter/nodeexec/v1/nodeexec.proto"),
  resolve(output, "proto/nodeexec.proto"),
  { force: true },
);
