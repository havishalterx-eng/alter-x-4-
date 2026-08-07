import { Body, Controller, Get, Param, Patch, Put, Req, UseFilters } from "@nestjs/common";
import {
  FeatureFlagNameSchema,
  ModelAliasPathSchema,
  UpdateModelAliasRequestSchema,
  UpdateProviderControlRequestSchema,
  UpsertFeatureFlagRequestSchema,
  type ProblemDetails,
} from "@alterx/contracts";
import { RequireStaffRole } from "../rbac/decorators";
import type { RbacRequest } from "../rbac/types";
import { AdminControlsExceptionFilter } from "./admin-controls-exception.filter";
import { AdminControlsService } from "./admin-controls.service";
import { AdminControlsHttpError } from "./problem";

const readRoles = ["staff_admin", "staff_support", "staff_billing_ops", "staff_security"] as const;

@Controller("/api/v1/admin")
@UseFilters(AdminControlsExceptionFilter)
export class AdminControlsController {
  constructor(private readonly controls: AdminControlsService) {}

  @Get("providers")
  @RequireStaffRole(...readRoles)
  listProviders() {
    return this.controls.listProviders();
  }

  @Patch("providers/:providerId")
  @RequireStaffRole("staff_admin")
  updateProvider(
    @Param("providerId") providerId: string,
    @Body() body: unknown,
    @Req() request: RbacRequest,
  ) {
    const instance = `/api/v1/admin/providers/${providerId}`;
    if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(providerId)) {
      throw invalid(instance, "providerId", "Invalid provider identifier");
    }
    return this.controls.updateProvider(
      providerId,
      requireStaff(request, instance),
      parse(UpdateProviderControlRequestSchema, body, instance),
    );
  }

  @Get("policy/feature-flags")
  @RequireStaffRole(...readRoles)
  listFeatureFlags() {
    return this.controls.listFeatureFlags();
  }

  @Put("policy/feature-flags/:name")
  @RequireStaffRole("staff_admin")
  upsertFeatureFlag(
    @Param("name") rawName: string,
    @Body() body: unknown,
    @Req() request: RbacRequest,
  ) {
    const instance = `/api/v1/admin/policy/feature-flags/${rawName}`;
    const name = parse(FeatureFlagNameSchema, rawName, instance);
    return this.controls.upsertFeatureFlag(
      name,
      requireStaff(request, instance),
      parse(UpsertFeatureFlagRequestSchema, body, instance),
    );
  }

  @Get("policy/model")
  @RequireStaffRole(...readRoles)
  getModelPolicy() {
    return this.controls.getModelPolicy();
  }

  @Put("policy/model/:alias")
  @RequireStaffRole("staff_admin")
  updateModelAlias(
    @Param("alias") rawAlias: string,
    @Body() body: unknown,
    @Req() request: RbacRequest,
  ) {
    const instance = `/api/v1/admin/policy/model/${rawAlias}`;
    const alias = parse(ModelAliasPathSchema, rawAlias, instance);
    return this.controls.updateModelAlias(
      alias,
      requireStaff(request, instance),
      parse(UpdateModelAliasRequestSchema, body, instance),
    );
  }
}

function requireStaff(request: RbacRequest, instance: string): string {
  const staff = request.staffActorContext;
  if (!staff) {
    throw new AdminControlsHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated staff actor required",
      instance,
    );
  }
  return staff.staff_user_id;
}

function parse<T>(schema: SafeParser<T>, value: unknown, instance: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new AdminControlsHttpError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed",
    instance,
    parsed.error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "value",
      message: issue.message,
    })),
  );
}

interface SafeParser<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
}

function invalid(
  instance: string,
  field: string,
  message: string,
): AdminControlsHttpError {
  return new AdminControlsHttpError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed",
    instance,
    [{ field, message }] satisfies ProblemDetails["field_errors"],
  );
}
