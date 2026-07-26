import { Module } from "@nestjs/common";
import { AwsSecretsManagerProvider } from "@alterx/adapters";
import { Pool } from "pg";
import {
  ConcurrencyExceptionFilter,
  ETAG_RESOURCE_RESOLVER,
  EtagResponseInterceptor,
  IfMatchGuard,
} from "../concurrency";
import { IdempotencyModule } from "../idempotency";
import { CredentialController } from "./credential.controller";
import { CredentialEtagResolver } from "./credential-etag.resolver";
import { CredentialExceptionFilter } from "./credential-exception.filter";
import { CredentialRepository } from "./credential.repository";
import { CredentialService } from "./credential.service";
import { CREDENTIAL_SECRETS_PROVIDER } from "./tokens";

@Module({
  imports: [IdempotencyModule],
  controllers: [CredentialController],
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
