import { createHash } from "node:crypto";
import { Module } from "@nestjs/common";
import { MockEmailProvider, SesEmailProvider } from "@alterx/adapters";
import { Pool } from "pg";
import { resolveRuntimeSecret } from "../identity/identity.module";
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
      useFactory: () => new NotificationRepository(new Pool({ connectionString: process.env.DATABASE_URL }), true),
    },
    {
      provide: EMAIL_PROVIDER,
      useFactory: () => {
        const fromAddress = process.env.SES_FROM_ADDRESS;
        const credentialsSecretRef = process.env.SES_CREDENTIALS_SECRET_REF;
        if (fromAddress === undefined && credentialsSecretRef === undefined) return new MockEmailProvider();
        if (!fromAddress || !credentialsSecretRef) {
          throw new Error("SES_FROM_ADDRESS and SES_CREDENTIALS_SECRET_REF must be configured together");
        }
        return new SesEmailProvider(
          {
            region: process.env.AWS_REGION ?? "ap-south-1",
            fromAddress,
            credentialsSecretRef,
          },
          resolveRuntimeSecret,
        );
      },
    },
    {
      // Real, separate bypass-RLS connection for the digest scheduler's
      // cross-tenant enumeration only -- undefined (fails closed, see
      // SystemNotificationStore) until the real platform_db system role
      // is provisioned. NOTIFICATION_DIGEST_SYSTEM_DATABASE_URL must
      // point at a role with a real BYPASSRLS grant, never the normal
      // per-request role.
      provide: SystemNotificationStore,
      useFactory: () => {
        const systemDatabaseUrl = process.env.NOTIFICATION_DIGEST_SYSTEM_DATABASE_URL;
        return new SystemNotificationStore(
          systemDatabaseUrl ? new Pool({ connectionString: systemDatabaseUrl }) : undefined,
        );
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
