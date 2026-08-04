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
import { EnvVarController } from "./env-var.controller";
import { EnvVarEtagResolver } from "./env-var-etag.resolver";
import { EnvVarExceptionFilter } from "./env-var-exception.filter";
import { EnvVarRepository } from "./env-var.repository";
import { EnvVarService } from "./env-var.service";
import { ENV_VAR_SECRETS_PROVIDER } from "./tokens";

@Module({
  imports: [IdempotencyModule],
  controllers: [EnvVarController],
  providers: [
    {
      provide: EnvVarRepository,
      useFactory: () =>
        new EnvVarRepository(
          new Pool({ connectionString: process.env.DATABASE_URL }),
          true,
        ),
    },
    {
      provide: ENV_VAR_SECRETS_PROVIDER,
      useFactory: () =>
        new AwsSecretsManagerProvider({
          region: process.env.AWS_REGION ?? "ap-south-1",
        }),
    },
    EnvVarService,
    EnvVarEtagResolver,
    {
      provide: ETAG_RESOURCE_RESOLVER,
      useExisting: EnvVarEtagResolver,
    },
    IfMatchGuard,
    EtagResponseInterceptor,
    ConcurrencyExceptionFilter,
    EnvVarExceptionFilter,
  ],
  exports: [EnvVarService],
})
export class EnvVarModule {}
