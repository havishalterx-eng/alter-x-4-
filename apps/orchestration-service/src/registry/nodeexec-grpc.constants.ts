import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceNodeexecProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/nodeexec/v1/nodeexec.proto",
);

export const NODEEXEC_PROTO_PATH = existsSync(workspaceNodeexecProtoPath)
  ? workspaceNodeexecProtoPath
  : resolve(__dirname, "../../proto/nodeexec.proto");
