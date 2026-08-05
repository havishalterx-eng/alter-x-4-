import { Controller, Get, Query, UseFilters } from "@nestjs/common";
import { z } from "zod";
import { ActorContext, RequireTenantRole, type ActorContextType } from "../rbac";
import { PlatformHttpError } from "../signup/problem";
import { InvalidSupportAccessCursorError } from "./staff.repository";
import { StaffService } from "./staff.service";
import { SupportAccessExceptionFilter } from "./support-access-exception.filter";

const querySchema = z.object({
  cursor: z.string().min(1).max(4096).refine(isValidCursor, "Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

@Controller("/api/v1/support-access")
@RequireTenantRole("admin")
@UseFilters(SupportAccessExceptionFilter)
export class SupportAccessController {
  constructor(private readonly staff: StaffService) {}

  @Get("grants")
  async list(
    @Query() query: unknown,
    @ActorContext() actor: ActorContextType | undefined,
  ) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) {
      throw invalidPaginationError();
    }
    try {
      const page = await this.staff.listForTenant(requireActor(actor).tenant_id, parsed.data);
      return {
        data: page.data.map((grant) => ({
          id: grant.id,
          reason_code: grant.reason_code,
          reason_text: grant.reason_text,
          granted_at: grant.granted_at.toISOString(),
          expires_at: grant.expires_at.toISOString(),
          revoked_at: grant.revoked_at?.toISOString() ?? null,
          staff_roles: grant.staff_roles,
        })),
        page: page.page,
      };
    } catch (error) {
      if (
        error instanceof InvalidSupportAccessCursorError ||
        (error instanceof Error && error.name === "InvalidSupportAccessCursorError")
      ) {
        throw invalidPaginationError();
      }
      throw error;
    }
  }
}

function invalidPaginationError(): PlatformHttpError {
  return new PlatformHttpError(
    400,
    "INVALID_SUPPORT_ACCESS_PAGINATION",
    "Support access pagination is invalid",
    "/api/v1/support-access/grants",
  );
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

function requireActor(actor: ActorContextType | undefined): ActorContextType {
  if (!actor) {
    throw new PlatformHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
      "/api/v1/support-access/grants",
    );
  }
  return actor;
}
