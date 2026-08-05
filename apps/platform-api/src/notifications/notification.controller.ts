import { Body, Controller, Get, Param, Patch, Post, Query, UseFilters } from "@nestjs/common";
import { ActorContext, RequireWorkspaceRole, type ActorContextType } from "../rbac";
import { NotificationExceptionFilter } from "./notification-exception.filter";
import { NotificationService } from "./notification.service";
import { parseListInput, parseNotificationId, parsePreferences } from "./validation";

const workspaceRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;

@Controller("/api/v1/notifications")
@UseFilters(NotificationExceptionFilter)
@RequireWorkspaceRole(...workspaceRoles)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Query() query: unknown, @ActorContext() actor: ActorContextType) {
    return this.notifications.list(parseListInput(actor.tenant_id, actor.user_id, query));
  }

  @Post(":id/actions/read")
  markRead(@Param("id") id: string, @ActorContext() actor: ActorContextType) {
    return this.notifications.markRead(
      actor.tenant_id,
      actor.user_id,
      parseNotificationId(id, `/api/v1/notifications/${encodeURIComponent(id)}/actions/read`),
    );
  }

  @Post(":id/actions/acknowledge")
  acknowledge(@Param("id") id: string, @ActorContext() actor: ActorContextType) {
    return this.notifications.acknowledge(
      actor.tenant_id,
      actor.user_id,
      parseNotificationId(id, `/api/v1/notifications/${encodeURIComponent(id)}/actions/acknowledge`),
    );
  }

  @Get("preferences")
  preferences(@ActorContext() actor: ActorContextType) {
    return this.notifications.listPreferences(actor.tenant_id, actor.user_id);
  }

  @Patch("preferences")
  async updatePreferences(@Body() body: unknown, @ActorContext() actor: ActorContextType) {
    const preferences = parsePreferences(body);
    await Promise.all(
      preferences.map((preference) =>
        this.notifications.updatePreference(
          actor.tenant_id,
          actor.user_id,
          preference.eventClass,
          preference.channel,
          preference.enabled,
          preference.deliveryMode,
        ),
      ),
    );
    return this.notifications.listPreferences(actor.tenant_id, actor.user_id);
  }
}
