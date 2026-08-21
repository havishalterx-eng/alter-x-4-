import { createHash } from "node:crypto";
import { Module } from "@nestjs/common";
import { MockEmailProvider, SesEmailProvider } from "@alterx/adapters";
import type { EmailProvider } from "@alterx/shared-clients";
import { Pool } from "pg";
import { resolveRuntimeSecret } from "../identity/identity.module";
import { sharedPool } from "../db/shared-pool";
import { poolSizeConfigFromEnvironment } from "../db/pool-config";
import { NotificationController } from "./notification.controller";
import { NotificationDigestSchedulerController, NOTIFICATION_DIGEST_SERVICE_TOKEN_HASH } from "./notification-digest-scheduler.controller";
import { NotificationExceptionFilter } from "./notification-exception.filter";
import { NotificationRepository } from "./notification.repository";
import { NotificationService } from "./notification.service";
import { SystemNotificationStore } from "./system-notification-store";
import { EMAIL_PROVIDER } from "./tokens";

@Module({
  controllers: [NotificationController, NotificationDigestSchedulerController],
  providers: [
    {
      provide: NotificationRepository,
      useFactory: () => new NotificationRepository(sharedPool(process.env.DATABASE_URL), false),
    },
    {
      provide: EMAIL_PROVIDER,
      useFactory: resolveEmailProvider,
    },
    {
      // Real, separate bypass-RLS connection for the digest scheduler's
      // cross-tenant enumeration only -- undefined (fails closed, see
      // SystemNotificationStore) until the real platform_db system role
      // is provisioned. NOTIFICATION_DIGEST_SYSTEM_DATABASE_URL must
      // point at a role with a real BYPASSRLS grant, never the normal
      // per-request role. Deliberately its own dedicated pool, not one of
      // db.module.ts's shared tokens -- unique connection string, unique
      // call site. Still gets the same size/timeout config
      // (ENGINE-FIX-P3-6) as every other pool in this app.
      provide: SystemNotificationStore,
      useFactory: () => {
        const systemDatabaseUrl = process.env.NOTIFICATION_DIGEST_SYSTEM_DATABASE_URL;
        if (!systemDatabaseUrl) return new SystemNotificationStore(undefined);
        const size = poolSizeConfigFromEnvironment(process.env);
        return new SystemNotificationStore(new Pool({ connectionString: systemDatabaseUrl, ...size }));
      },
    },
    {
      provide: NOTIFICATION_DIGEST_SERVICE_TOKEN_HASH,
      useFactory: async () => {
        const reference = process.env.NOTIFICATION_DIGEST_SERVICE_TOKEN_REF;
        if (!reference) {
          throw new Error("NOTIFICATION_DIGEST_SERVICE_TOKEN_REF must be configured");
        }
        const token = await resolveRuntimeSecret(reference);
        return createHash("sha256").update(token).digest("hex");
      },
    },
    NotificationService,
    NotificationExceptionFilter,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}

// ENGINE-FIX-P3-17: was raw SES_FROM_ADDRESS/SES_CREDENTIALS_SECRET_REF
// presence sniffing -- both vars absent fell through to MockEmailProvider
// silently in any environment including production, with no fatal check at
// all. Now EMAIL_PROVIDER drives an explicit switch (same shape as
// identity.module.ts's IDENTITY_PROVIDER): "ses" missing its paired config
// throws instead of silently downgrading; mock is fatal when
// NODE_ENV=production. Exported (not inlined in the useFactory) so it's
// directly unit-testable without standing up the full NestJS module graph,
// matching this file's existing resolveRuntimeSecret precedent.
export function resolveEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER ?? "mock";
  if (provider === "ses") {
    const fromAddress = process.env.SES_FROM_ADDRESS;
    const credentialsSecretRef = process.env.SES_CREDENTIALS_SECRET_REF;
    if (!fromAddress || !credentialsSecretRef) {
      throw new Error(
        "SES_FROM_ADDRESS and SES_CREDENTIALS_SECRET_REF are required when EMAIL_PROVIDER=ses",
      );
    }
    return new SesEmailProvider(
      {
        region: process.env.AWS_REGION ?? "ap-south-1",
        fromAddress,
        credentialsSecretRef,
      },
      resolveRuntimeSecret,
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("EMAIL_PROVIDER=mock is not allowed when NODE_ENV=production");
  }
  return new MockEmailProvider();
}
