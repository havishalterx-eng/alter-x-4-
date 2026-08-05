import { existsSync } from "node:fs";
import { resolve } from "node:path";
const workspaceProto = resolve(process.cwd(), "packages/contracts/proto/alter/artifacts/v1/artifacts.proto");
export const ARTIFACT_CONTENT_PROTO_PATH = existsSync(workspaceProto) ? workspaceProto : resolve(__dirname, "../../proto/artifacts.proto");
