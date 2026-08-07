import { Body, Controller, Get, Param, Post, Query, Req, UseFilters } from "@nestjs/common";
import { ReviewAbuseSignalRequestSchema } from "@alterx/contracts";
import { RequireStaffRole } from "../rbac/decorators";
import type { RbacRequest } from "../rbac/types";
import { AbuseSignalService } from "./abuse-signal.service";
import { AbuseSignalExceptionFilter } from "./abuse-signal-exception.filter";
import { AbuseSignalsHttpError } from "./problem";

const readRoles = ["staff_admin", "staff_security"] as const;

@Controller("/api/v1/admin/abuse/signals")
@UseFilters(AbuseSignalExceptionFilter)
export class AbuseSignalController {
  constructor(private readonly signals: AbuseSignalService) {}

  @Get()
  @RequireStaffRole(...readRoles)
  list(@Query("status") status?: string) {
    if (status !== undefined && !["open", "confirmed", "dismissed"].includes(status)) {
      throw badRequest("/api/v1/admin/abuse/signals", "Invalid signal status");
    }
    return this.signals.list(status as "open" | "confirmed" | "dismissed" | undefined);
  }

  @Post("actions/refresh")
  @RequireStaffRole(...readRoles)
  refresh(@Req() request: RbacRequest) {
    return this.signals.refresh(staffId(request, "/api/v1/admin/abuse/signals/actions/refresh"));
  }

  @Post(":id/actions/review")
  @RequireStaffRole(...readRoles)
  review(@Param("id") id: string, @Body() body: unknown, @Req() request: RbacRequest) {
    const instance = `/api/v1/admin/abuse/signals/${id}/actions/review`;
    if (!/^abs_[0-9a-f-]{36}$/i.test(id)) throw badRequest(instance, "Invalid abuse signal id");
    const parsed = ReviewAbuseSignalRequestSchema.safeParse(body);
    if (!parsed.success) throw badRequest(instance, "Invalid abuse review request");
    return this.signals.review(id, staffId(request, instance), parsed.data);
  }
}

function staffId(request: RbacRequest, instance: string): string {
  const id = request.staffActorContext?.staff_user_id;
  if (!id) throw new AbuseSignalsHttpError(401, "AUTHENTICATION_REQUIRED", "Authenticated staff actor required", instance);
  return id;
}

function badRequest(instance: string, detail: string): AbuseSignalsHttpError {
  return new AbuseSignalsHttpError(400, "VALIDATION_ERROR", detail, instance);
}
