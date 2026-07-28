import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceProto = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/sandbox/v1/sandbox.proto",
);

export const SANDBOX_PROTO_PATH = existsSync(workspaceProto)
  ? workspaceProto
  : resolve(
      __dirname,
      "../../../../../packages/contracts/proto/alter/sandbox/v1/sandbox.proto",
    );
