import { resolve } from "node:path";

export const CAPABILITY_CLIENT_PROTO_PATH = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/capability/v1/capability.proto",
);
