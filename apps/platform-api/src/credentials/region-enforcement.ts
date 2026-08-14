import type { AuditEventHandler } from "@alterx/shared-clients";

export class RegionMismatchError extends Error {
  constructor(
    readonly tenantRegion: string,
    readonly destinationRegion: string,
  ) {
    super(`Tenant region ${tenantRegion} does not match destination region ${destinationRegion}`);
    this.name = "RegionMismatchError";
  }
}

export interface RegionEnforcementContext {
  tenantId: string;
  actorType: "user" | "service" | "admin" | "support" | "system";
  actorRef: string;
  action: string;
  targetType: string;
  targetRef: string;
}

export async function assertTenantRegion(
  tenantRegion: string,
  destinationRegion: string,
  audit: AuditEventHandler,
  context: RegionEnforcementContext,
): Promise<void> {
  const passed = tenantRegion === destinationRegion;
  
  await audit.recordEvent({
    tenant_id: context.tenantId,
    actor_type: context.actorType,
    actor_ref: context.actorRef,
    action: context.action,
    target_type: context.targetType,
    target_ref: context.targetRef,
    result: passed ? "success" : "denied",
    reason_code: passed ? "" : `region_mismatch:${tenantRegion}!=${destinationRegion}`,
    context_json: "{}",
    occurred_at: new Date().toISOString(),
  });

  if (!passed) {
    throw new RegionMismatchError(tenantRegion, destinationRegion);
  }
}
