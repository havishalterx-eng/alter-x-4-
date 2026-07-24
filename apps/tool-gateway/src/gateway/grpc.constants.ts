import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/toolgw/v1/toolgw.proto",
);

export const TOOLGW_PROTO_PATH = existsSync(workspaceProtoPath)
  ? workspaceProtoPath
  : resolve(__dirname, "../proto/toolgw.proto");
