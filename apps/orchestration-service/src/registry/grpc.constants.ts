import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRegistryProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/registry/v1/registry.proto",
);

export const REGISTRY_PROTO_PATH = existsSync(workspaceRegistryProtoPath)
  ? workspaceRegistryProtoPath
  : resolve(__dirname, "../../proto/registry.proto");
