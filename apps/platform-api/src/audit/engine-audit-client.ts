import { resolve } from "node:path";
import { AuditServiceClient } from "@alterx/adapters";
import { lazyAuth0M2mTokenProviderFromEnvironment } from "@alterx/auth";

/** The Engine audit service client, authenticated with the Engine M2M credentials. */
export function engineAuditClientFromEnvironment(): AuditServiceClient {
  return new AuditServiceClient({
    address: process.env.AUDIT_SERVICE_GRPC_ADDRESS ?? "127.0.0.1:50054",
    protoPath: resolve(process.cwd(), "packages/contracts/proto/alter/audit/v1/audit.proto"),
    accessTokenProvider: lazyAuth0M2mTokenProviderFromEnvironment({
      ...process.env,
      AUTH0_M2M_TOKEN_URL: process.env.ENGINE_M2M_TOKEN_URL ?? process.env.AUTH0_M2M_TOKEN_URL,
      AUTH0_M2M_AUDIENCE: process.env.ENGINE_M2M_AUDIENCE ?? process.env.AUTH0_M2M_AUDIENCE,
      AUTH0_M2M_CLIENT_ID: process.env.ENGINE_M2M_CLIENT_ID ?? process.env.AUTH0_M2M_CLIENT_ID,
      AUTH0_M2M_CLIENT_SECRET: process.env.ENGINE_M2M_CLIENT_SECRET ?? process.env.AUTH0_M2M_CLIENT_SECRET,
    }),
  });
}
