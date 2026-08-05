import { BadRequestException, Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { RequireStaffRole } from "../rbac/decorators";
import type { RbacRequest } from "../rbac/types";
import { StaffService } from "./staff.service";

interface GrantRequest {
  tenant_id: string;
  reason_code: string;
  reason_text: string;
  duration_minutes: number;
}

@Controller("/api/v1/admin/staff-access")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post("grants")
  @RequireStaffRole("staff_admin")
  grant(@Body() body: GrantRequest, @Req() request: RbacRequest) {
    validateGrantRequest(body);
    return this.staff.grant(
      request.staffActorContext!.staff_user_id,
      body.tenant_id,
      body.reason_code,
      body.reason_text,
      body.duration_minutes,
    );
  }

  @Post("grants/:id/actions/revoke")
  @RequireStaffRole("staff_admin")
  revoke(@Param("id") id: string, @Req() request: RbacRequest) {
    return this.staff.revoke(id, request.staffActorContext!.staff_user_id);
  }

  @Get("grants")
  @RequireStaffRole("staff_admin", "staff_support", "staff_billing_ops", "staff_security")
  list(@Req() request: RbacRequest) {
    const staff = request.staffActorContext!;
    return this.staff.list(staff.staff_user_id, staff.roles.includes("staff_admin"));
  }
}

function validateGrantRequest(body: GrantRequest): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.tenant_id,
    ) ||
    !body.reason_code?.trim() ||
    !body.reason_text?.trim() ||
    !Number.isInteger(body.duration_minutes) ||
    body.duration_minutes < 1 ||
    body.duration_minutes > 480
  ) {
    throw new BadRequestException("Invalid staff access grant request");
  }
}
