import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceCompilerProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/compiler/v1/compiler.proto",
);

export const COMPILER_PROTO_PATH = existsSync(workspaceCompilerProtoPath)
  ? workspaceCompilerProtoPath
  : resolve(__dirname, "../../proto/compiler.proto");
