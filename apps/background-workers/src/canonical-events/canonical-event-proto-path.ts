import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRunsProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/runs/v1/runs.proto",
);

export const RUNS_PROTO_PATH = existsSync(workspaceRunsProtoPath)
  ? workspaceRunsProtoPath
  : resolve(__dirname, "../../proto/runs.proto");