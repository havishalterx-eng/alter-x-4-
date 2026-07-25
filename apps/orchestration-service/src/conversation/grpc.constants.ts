import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceConversationProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/conversation/v1/conversation.proto",
);

export const CONVERSATION_PROTO_PATH = existsSync(
  workspaceConversationProtoPath,
)
  ? workspaceConversationProtoPath
  : resolve(__dirname, "../../proto/conversation.proto");

const workspaceModelgwProtoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/modelgw/v1/modelgw.proto",
);

export const MODELGW_CLIENT_PROTO_PATH = existsSync(workspaceModelgwProtoPath)
  ? workspaceModelgwProtoPath
  : resolve(__dirname, "../../proto/modelgw.proto");
