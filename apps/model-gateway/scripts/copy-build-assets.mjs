import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist/apps/model-gateway");

await mkdir(resolve(output, "proto"), { recursive: true });
await cp(
  resolve(root, "packages/contracts/proto/alter/modelgw/v1/modelgw.proto"),
  resolve(output, "proto/modelgw.proto"),
  { force: true },
);
