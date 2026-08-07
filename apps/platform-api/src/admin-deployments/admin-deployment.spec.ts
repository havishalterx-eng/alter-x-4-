import { describe, expect, it, vi } from "vitest";
import type { AdminAuditService } from "../admin-audit";
import type { DeploymentAdminClient } from "../engine";
import { staffRolesMetadataKey } from "../rbac/rbac.metadata";
import { AdminDeploymentController } from "./admin-deployment.controller";
import { AdminDeploymentService } from "./admin-deployment.service";

const INPUT = {
  tenant_id: "018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  deployment_id: "dep_018f4d6e-2b4a-7a3e-8c1a-1234567890a2",
  action: "suspend" as const,
  reason: "provider incident",
};
const RESULT = {
  tenant_id: INPUT.tenant_id,
  deployment_id: INPUT.deployment_id,
  action: INPUT.action,
  project_id: "prj_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  status: "suspended" as const,
  active_deployment_id: null,
  updated_at: "2026-08-06T12:00:00.000Z",
};

describe("admin deployment plane", () => {
  it("allows only staff_admin role on mutation route", () => {
    expect(Reflect.getMetadata(staffRolesMetadataKey, AdminDeploymentController.prototype.apply))
      .toEqual(["staff_admin"]);
  });

  it("executes Engine action before central audit", async () => {
    const sequence: string[] = [];
    const client = { apply: vi.fn(async () => { sequence.push("engine"); return RESULT; }) };
    const audit = { record: vi.fn(async () => { sequence.push("audit"); return "a".repeat(64); }) };
    const service = new AdminDeploymentService(client as unknown as DeploymentAdminClient, audit as unknown as AdminAuditService);
    await expect(service.apply(INPUT, "stf_admin", "trace")).resolves.toEqual(RESULT);
    expect(sequence).toEqual(["engine", "audit"]);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: INPUT.tenant_id,
      action: "deployment.suspend",
      targetRef: INPUT.deployment_id,
      actorRef: "stf_admin",
    }));
  });

  it("requires matching route and body deployment IDs", async () => {
    const service = { apply: vi.fn() } as unknown as AdminDeploymentService;
    const controller = new AdminDeploymentController(service);
    expect(() => controller.apply("dep_018f4d6e-2b4a-7a3e-8c1a-1234567890a1", INPUT, {
      staffActorContext: { staff_user_id: "stf_admin" },
    } as never, undefined)).toThrow(expect.objectContaining({
      response: expect.objectContaining({ detail: "Body deployment_id must match route deploymentId" }),
    }));
    expect(service.apply).not.toHaveBeenCalled();
  });
});
