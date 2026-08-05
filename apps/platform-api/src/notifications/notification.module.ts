import { Module } from "@nestjs/common";
import { MockEmailProvider, SesEmailProvider } from "@alterx/adapters";
import { Pool } from "pg";
import { resolveRuntimeSecret } from "../identity/identity.module";
import { NotificationController } from "./notification.controller";
import { NotificationExceptionFilter } from "./notification-exception.filter";
import { NotificationRepository } from "./notification.repository";
import { NotificationService } from "./notification.service";
import { EMAIL_PROVIDER } from "./tokens";

@Module({
  controllers: [NotificationController],
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
    NotificationService,
    NotificationExceptionFilter,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
