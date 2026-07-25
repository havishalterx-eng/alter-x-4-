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

await mkdir(resolve(output, "proto"), { recursive: true });
await cp(
  resolve(
    root,
    "packages/contracts/proto/alter/conversation/v1/conversation.proto",
  ),
  resolve(output, "proto/conversation.proto"),
  { force: true },
);
await cp(
  resolve(root, "packages/contracts/proto/alter/modelgw/v1/modelgw.proto"),
  resolve(output, "proto/modelgw.proto"),
  { force: true },
);
