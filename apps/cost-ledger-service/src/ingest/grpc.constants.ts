import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceCostProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/cost/v1/cost.proto",
);

export const COST_PROTO_PATH = existsSync(workspaceCostProtoPath)
  ? workspaceCostProtoPath
  : resolve(__dirname, "../../proto/cost.proto");
