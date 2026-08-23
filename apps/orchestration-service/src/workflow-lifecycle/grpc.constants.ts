import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceDeployctlProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/deployctl/v1/deployctl.proto",
);

export const DEPLOYCTL_PROTO_PATH = existsSync(workspaceDeployctlProtoPath)
  ? workspaceDeployctlProtoPath
  : resolve(__dirname, "../../proto/deployctl.proto");
