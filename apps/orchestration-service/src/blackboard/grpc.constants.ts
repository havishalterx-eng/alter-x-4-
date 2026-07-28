import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceBlackboardProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/blackboard/v1/blackboard.proto",
);

export const BLACKBOARD_PROTO_PATH = existsSync(workspaceBlackboardProtoPath)
  ? workspaceBlackboardProtoPath
  : resolve(__dirname, "../../proto/blackboard.proto");
