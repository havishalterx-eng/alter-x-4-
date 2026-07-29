import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRecoveryProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/recovery/v1/recovery.proto",
);

export const RECOVERY_PROTO_PATH = existsSync(workspaceRecoveryProtoPath)
  ? workspaceRecoveryProtoPath
  : resolve(__dirname, "../../proto/recovery.proto");
