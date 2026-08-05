import { createHash, timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  Headers,
  HttpException,
  Inject,
  Post,
} from "@nestjs/common";
import { Public } from "../rbac/decorators";
import { NotificationHttpError } from "./problem";
import { NotificationService } from "./notification.service";

export const NOTIFICATION_DIGEST_SERVICE_TOKEN_HASH = Symbol(
  "NOTIFICATION_DIGEST_SERVICE_TOKEN_HASH",
);

interface RunDueDigestsBody {
  readonly period_start: string;
  readonly period_end: string;
}

/**
 * Internal-only, service-token authenticated -- same real trust boundary
 * and pattern as Engine's AuditQueryController/DeletionController.
 * @Public() bypasses the normal per-actor RBAC guard (there is no real
 * user actor for a service-to-service call); authorize() below is the
 * real security boundary in its place. Only background-workers' Platform
 * Jobs worker should ever hold this shared secret.
 */
@Controller("internal/notifications")
export class NotificationDigestSchedulerController {
  constructor(
    private readonly notifications: NotificationService,
    @Inject(NOTIFICATION_DIGEST_SERVICE_TOKEN_HASH)
    private readonly tokenHash: string,
  ) {}

  private authorize(value: string | undefined): void {
    const token = value?.startsWith("Bearer ") ? value.slice(7) : "";
    const actual = createHash("sha256").update(token).digest();
    const expected = Buffer.from(this.tokenHash, "hex");
    if (!token || expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      throw new HttpException(
        {
          type: "https://alter.dev/problems/unauthorized",
          title: "Unauthorized",
          status: 401,
          instance: "/internal/notifications/run-due-digests",
        },
        401,
      );
    }
  }

  @Public()
  @Post("run-due-digests")
  async runDueDigests(
    @Body() body: RunDueDigestsBody,
    @Headers("authorization") auth?: string,
  ) {
    this.authorize(auth);
    const periodStart = new Date(body.period_start);
    const periodEnd = new Date(body.period_end);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new NotificationHttpError(
        400,
        "NOTIFICATION_DIGEST_INVALID_WINDOW",
        "period_start and period_end must be valid ISO timestamps",
        "/internal/notifications/run-due-digests",
      );
    }
    const result = await this.notifications.runDueDigests(periodStart, periodEnd);
    return {
      users_processed: result.usersProcessed,
      users_failed: result.usersFailed,
    };
  }
}
