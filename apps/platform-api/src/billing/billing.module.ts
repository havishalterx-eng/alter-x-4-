import { Module } from "@nestjs/common";
import {
  AwsSecretsManagerProvider,
  RazorpayBillingProvider,
} from "@alterx/adapters";
import type { SecretsProvider } from "@alterx/shared-clients";
import { Pool } from "pg";
import {
  ConcurrencyExceptionFilter,
  ETAG_RESOURCE_RESOLVER,
  EtagResponseInterceptor,
  IfMatchGuard,
} from "../concurrency";
import { IdempotencyModule } from "../idempotency";
import { BillingEtagResolver } from "./billing-etag.resolver";
import { BillingExceptionFilter } from "./billing-exception.filter";
import { BillingController } from "./billing.controller";
import { BillingRepository } from "./billing.repository";
import { BillingService } from "./billing.service";
import { BILLING_PROVIDER, BILLING_SECRETS_PROVIDER } from "./tokens";

@Module({
  imports: [IdempotencyModule],
  controllers: [BillingController],
  providers: [
    {
      provide: BillingRepository,
      useFactory: () =>
        new BillingRepository(
          new Pool({ connectionString: process.env.DATABASE_URL }),
          true,
        ),
    },
    {
      provide: BILLING_SECRETS_PROVIDER,
      useFactory: () =>
        new AwsSecretsManagerProvider({
          region: process.env.AWS_REGION ?? "ap-south-1",
        }),
    },
    {
      provide: BILLING_PROVIDER,
      inject: [BILLING_SECRETS_PROVIDER, BillingRepository],
      useFactory: (
        secrets: SecretsProvider,
        repository: BillingRepository,
      ) =>
        new RazorpayBillingProvider(
          {
            keyIdSecretRef:
              process.env.RAZORPAY_KEY_ID_SECRET_REF ??
              "/alter/billing/razorpay/key-id",
            keySecretSecretRef:
              process.env.RAZORPAY_KEY_SECRET_SECRET_REF ??
              "/alter/billing/razorpay/key-secret",
          },
          secrets,
          repository,
        ),
    },
    BillingService,
    BillingEtagResolver,
    {
      provide: ETAG_RESOURCE_RESOLVER,
      useExisting: BillingEtagResolver,
    },
    IfMatchGuard,
    EtagResponseInterceptor,
    ConcurrencyExceptionFilter,
    BillingExceptionFilter,
  ],
})
export class BillingModule {}
