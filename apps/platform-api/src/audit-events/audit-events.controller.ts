import { Controller, Get, Query, UseFilters } from "@nestjs/common";
import { ActorContext, RequireStaffRole, RequireTenantRole, type ActorContextType } from "../rbac";
import { AuditEventsExceptionFilter } from "./audit-events-exception.filter";
import { AuditEventsService } from "./audit-events.service";

const tenantReadRoles = ["owner", "admin", "billing", "member"] as const;
const staffReadRoles = ["staff_admin", "staff_support", "staff_billing_ops", "staff_security"] as const;

@Controller("/api/v1")
@UseFilters(AuditEventsExceptionFilter)
export class AuditEventsController {
  constructor(private readonly auditEvents: AuditEventsService) {}

  @Get("audit-events")
  @RequireTenantRole(...tenantReadRoles)
  customer(
    @Query() query: unknown,
    @ActorContext() actor: ActorContextType | undefined,
  ) {
    return this.auditEvents.customer(query, actor);
  }

  @Get("admin/audit-events")
  @RequireStaffRole(...staffReadRoles)
  staff(@Query() query: unknown) {
    return this.auditEvents.staff(query);
  }
}
