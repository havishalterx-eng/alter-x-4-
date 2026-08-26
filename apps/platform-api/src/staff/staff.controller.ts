import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { CreateJitGrantRequestSchema, type CreateJitGrantRequest } from "@alterx/contracts";
import { RequireStaffRole } from "../rbac/decorators";
import type { RbacRequest } from "../rbac/types";
import { InvalidSupportAccessCursorError } from "./staff.repository";
import { StaffService } from "./staff.service";

// ENGINE-FIX-B8-2: same shape as support-access.controller.ts's own
// querySchema (kept as a local duplicate -- it's a 2-line zod object, not
// worth a cross-module import for) and same cursor validity check
// (isValidCursor below), since both endpoints decode with the same
// decodeTenantGrantCursor helper in staff.repository.ts.
const listGrantsQuerySchema = z.object({
  cursor: z.string().min(1).max(4096).refine(isValidCursor, "Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

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
  async list(@Query() query: unknown, @Req() request: RbacRequest) {
    const parsed = listGrantsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid staff access grants pagination");
    const staff = request.staffActorContext!;
    try {
      return await this.staff.list(
        staff.staff_user_id,
        staff.roles.includes("staff_admin"),
        parsed.data,
      );
    } catch (error) {
      if (
        error instanceof InvalidSupportAccessCursorError ||
        (error instanceof Error && error.name === "InvalidSupportAccessCursorError")
      ) {
        throw new BadRequestException("Invalid staff access grants pagination");
      }
      throw error;
    }
  }
}

function parseGrantRequest(value: unknown): CreateJitGrantRequest {
  const parsed = CreateJitGrantRequestSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException("Invalid staff access grant request");
  return parsed.data;
}

function isValidCursor(cursor: string): boolean {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
    return (
      typeof record?.grantedAt === "string" &&
      typeof record.id === "string" &&
      !Number.isNaN(Date.parse(record.grantedAt))
    );
  } catch {
    return false;
  }
}
