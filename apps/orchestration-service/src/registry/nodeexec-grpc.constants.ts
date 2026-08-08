import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceNodeexecProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/nodeexec/v1/nodeexec.proto",
);

export const NODEEXEC_PROTO_PATH = existsSync(workspaceNodeexecProtoPath)
  ? workspaceNodeexecProtoPath
  : resolve(__dirname, "../../proto/nodeexec.proto");

const workspaceToolgwProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/toolgw/v1/toolgw.proto",
);

export const TOOLGW_CLIENT_PROTO_PATH = existsSync(workspaceToolgwProtoPath)
  ? workspaceToolgwProtoPath
  : resolve(__dirname, "../../proto/toolgw.proto");

const workspaceVerifyProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/verify/v1/verify.proto",
);

export const VERIFY_CLIENT_PROTO_PATH = existsSync(workspaceVerifyProtoPath)
  ? workspaceVerifyProtoPath
  : resolve(__dirname, "../../proto/verify.proto");
