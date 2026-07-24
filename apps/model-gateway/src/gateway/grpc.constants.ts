import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/modelgw/v1/modelgw.proto",
);

export const MODELGW_PROTO_PATH = existsSync(workspaceProtoPath)
  ? workspaceProtoPath
  : resolve(__dirname, "../proto/modelgw.proto");
