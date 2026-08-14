import { Module } from "@nestjs/common";
import { resolve } from "node:path";
import { AuditServiceClient, AwsSecretsManagerProvider } from "@alterx/adapters";
import { lazyAuth0M2mTokenProviderFromEnvironment } from "@alterx/auth";
import { Pool } from "pg";
import {
  ConcurrencyExceptionFilter,
  ETAG_RESOURCE_RESOLVER,
  EtagResponseInterceptor,
  IfMatchGuard,
} from "../concurrency";
import { IdempotencyModule } from "../idempotency";
import { EngineModule } from "../engine/engine.module";
import { CredentialController } from "./credential.controller";
import { CredentialResumeController } from "./credential-resume.controller";
import { CredentialEtagResolver } from "./credential-etag.resolver";
import { CredentialExceptionFilter } from "./credential-exception.filter";
import { CredentialRepository } from "./credential.repository";
import { CredentialService } from "./credential.service";
import { CREDENTIAL_AUDIT_CLIENT, CREDENTIAL_SECRETS_PROVIDER } from "./tokens";

@Module({
  imports: [IdempotencyModule, EngineModule],
  controllers: [CredentialController, CredentialResumeController],
  providers: [
    {
      provide: CredentialRepository,
      useFactory: () =>
        new CredentialRepository(
          new Pool({ connectionString: process.env.DATABASE_URL }),
          true,
        ),
    },
    {
      provide: CREDENTIAL_SECRETS_PROVIDER,
      useFactory: () =>
        new AwsSecretsManagerProvider({
          region: process.env.AWS_REGION ?? "ap-south-1",
        }),
    },
    {
      provide: CREDENTIAL_AUDIT_CLIENT,
      useFactory: () =>
        new AuditServiceClient({
          address: process.env.AUDIT_SERVICE_GRPC_ADDRESS ?? "127.0.0.1:50054",
          protoPath: resolve(process.cwd(), "packages/contracts/proto/alter/audit/v1/audit.proto"),
          accessTokenProvider: lazyAuth0M2mTokenProviderFromEnvironment({
            ...process.env,
            AUTH0_M2M_TOKEN_URL: process.env.ENGINE_M2M_TOKEN_URL ?? process.env.AUTH0_M2M_TOKEN_URL,
            AUTH0_M2M_AUDIENCE: process.env.ENGINE_M2M_AUDIENCE ?? process.env.AUTH0_M2M_AUDIENCE,
            AUTH0_M2M_CLIENT_ID: process.env.ENGINE_M2M_CLIENT_ID ?? process.env.AUTH0_M2M_CLIENT_ID,
            AUTH0_M2M_CLIENT_SECRET: process.env.ENGINE_M2M_CLIENT_SECRET ?? process.env.AUTH0_M2M_CLIENT_SECRET,
          }),
        }),
    },
    CredentialService,
    CredentialEtagResolver,
    {
      provide: ETAG_RESOURCE_RESOLVER,
      useExisting: CredentialEtagResolver,
    },
    IfMatchGuard,
    EtagResponseInterceptor,
    ConcurrencyExceptionFilter,
    CredentialExceptionFilter,
  ],
  exports: [CredentialService],
})
export class CredentialModule {}
