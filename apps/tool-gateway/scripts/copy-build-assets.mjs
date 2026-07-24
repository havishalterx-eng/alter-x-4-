import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist/apps/tool-gateway");

await mkdir(resolve(output, "proto"), { recursive: true });
await cp(
  resolve(root, "packages/contracts/proto/alter/toolgw/v1/toolgw.proto"),
  resolve(output, "proto/toolgw.proto"),
  { force: true },
);
