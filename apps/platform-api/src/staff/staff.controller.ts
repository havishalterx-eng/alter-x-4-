import { BadRequestException, Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { CreateJitGrantRequestSchema, type CreateJitGrantRequest } from "@alterx/contracts";
import { RequireStaffRole } from "../rbac/decorators";
import type { RbacRequest } from "../rbac/types";
import { StaffService } from "./staff.service";

@Controller("/api/v1/admin/staff-access")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post("grants")
  @RequireStaffRole("staff_admin")
  grant(@Body() value: unknown, @Req() request: RbacRequest) {
    const body = parseGrantRequest(value);
    return this.staff.grant(
      request.staffActorContext!.staff_user_id,
      body.staff_user_id,
      body.tenant_id,
      body.reason_code,
      body.reason_text,
      body.duration_minutes,
      body.scopes,
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

function parseGrantRequest(value: unknown): CreateJitGrantRequest {
  const parsed = CreateJitGrantRequestSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException("Invalid staff access grant request");
  return parsed.data;
}
