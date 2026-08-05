import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/eval/v1/eval.proto",
);

export const EVAL_PROTO_PATH = existsSync(workspaceProtoPath)
  ? workspaceProtoPath
  : resolve(__dirname, "../../proto/eval.proto");
