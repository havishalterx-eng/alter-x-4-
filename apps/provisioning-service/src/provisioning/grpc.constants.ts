import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceProto = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/provisioning/v1/provisioning.proto",
);

export const PROVISIONING_PROTO_PATH = existsSync(workspaceProto)
  ? workspaceProto
  : resolve(
      __dirname,
      "../../../../../packages/contracts/proto/alter/provisioning/v1/provisioning.proto",
    );
