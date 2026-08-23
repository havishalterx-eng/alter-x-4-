import { describe, expect, it } from "vitest";
import type { OrchestrationTenantStore } from "../workflow-lifecycle/workflow-lifecycle.service";
import {
  DeploymentAdminConflictError,
  DeploymentAdminNotFoundError,
  DeploymentAdminService,
} from "./deployment-admin.service";

const TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const OTHER_TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890ac";
const PROJECT = "prj_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const OLD = "dep_018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const LIVE = "dep_018f4d6e-2b4a-7a3e-8c1a-1234567890a2";

type Status = "active" | "rolled_back" | "suspended";
interface Row {
  id: string;
  tenant_id: string;
  project_id: string;
  status: Status;
  created_at: string;
  updated_at: string;
}

function fixture(initial: Row[]) {
  const rows = initial.map((row) => ({ ...row }));
  const tenantCalls: string[] = [];
  const store: OrchestrationTenantStore = {
    async withTenant(tenantId, operation) {
      tenantCalls.push(tenantId);
      return operation({
        async query<TRow extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
          const normalized = sql.replace(/\s+/g, " ").trim();
          if (normalized.startsWith("SELECT id FROM deployments")) {
            const found = rows.filter((row) => row.tenant_id === values[0] && row.project_id === values[1] && row.status === "active" && row.id !== values[2]);
            return { rowCount: found.length, rows: found as unknown as readonly TRow[] };
          }
          if (normalized.startsWith("SELECT id, project_id, status") && normalized.includes("status = 'rolled_back'")) {
            const found = rows.filter((row) => row.tenant_id === values[0] && row.project_id === values[1] && row.status === "rolled_back" && row.created_at < String(values[2])).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 1);
            return { rowCount: found.length, rows: found as unknown as readonly TRow[] };
          }
          if (normalized.startsWith("SELECT id, project_id, status") && normalized.includes("id = $2")) {
            const found = rows.filter((row) => row.tenant_id === values[0] && row.id === values[1]);
            return { rowCount: found.length, rows: found as unknown as readonly TRow[] };
          }
          if (normalized.startsWith("UPDATE deployments")) {
            const found = rows.find((row) => row.tenant_id === values[0] && row.id === values[1] && row.status === values[2]);
            if (!found) return { rowCount: 0, rows: [] as readonly TRow[] };
            found.status = values[3] as Status;
            found.updated_at = "2026-08-06T12:00:00.000Z";
            return { rowCount: 1, rows: [found] as unknown as readonly TRow[] };
          }
          throw new Error(`Unhandled query: ${normalized}`);
        },
      });
    },
  };
  return { service: new DeploymentAdminService(store), rows, tenantCalls };
}

function row(id: string, status: Status, day: number, tenant = TENANT): Row {
  const timestamp = `2026-08-0${day}T00:00:00.000Z`;
  return { id, tenant_id: tenant, project_id: PROJECT, status, created_at: timestamp, updated_at: timestamp };
}

describe("DeploymentAdminService", () => {
  it("suspends and resumes real deployment state", async () => {
    const { service, rows } = fixture([row(LIVE, "active", 2)]);
    await expect(service.apply({ tenant_id: TENANT, deployment_id: LIVE, action: "suspend", reason: "incident" })).resolves.toMatchObject({ status: "suspended", active_deployment_id: null });
    expect(rows[0]?.status).toBe("suspended");
    await expect(service.apply({ tenant_id: TENANT, deployment_id: LIVE, action: "resume", reason: "resolved" })).resolves.toMatchObject({ status: "active", active_deployment_id: LIVE });
    expect(rows[0]?.status).toBe("active");
  });

  it("rolls active deployment back and restores latest prior deployment", async () => {
    const { service, rows } = fixture([row(OLD, "rolled_back", 1), row(LIVE, "active", 2)]);
    await expect(service.apply({ tenant_id: TENANT, deployment_id: LIVE, action: "rollback", reason: "regression" })).resolves.toMatchObject({ status: "rolled_back", active_deployment_id: OLD });
    expect(rows.map(({ id, status }) => ({ id, status }))).toEqual([{ id: OLD, status: "active" }, { id: LIVE, status: "rolled_back" }]);
  });

  it("rejects invalid transitions and rollback without prior release", async () => {
    const { service } = fixture([row(LIVE, "active", 2)]);
    await expect(service.apply({ tenant_id: TENANT, deployment_id: LIVE, action: "resume", reason: "bad" })).rejects.toThrow(DeploymentAdminConflictError);
    await expect(service.apply({ tenant_id: TENANT, deployment_id: LIVE, action: "rollback", reason: "bad" })).rejects.toThrow(DeploymentAdminConflictError);
  });

  it("cannot access another tenant deployment", async () => {
    const { service, tenantCalls } = fixture([row(LIVE, "active", 2, OTHER_TENANT)]);
    await expect(service.apply({ tenant_id: TENANT, deployment_id: LIVE, action: "suspend", reason: "test" })).rejects.toThrow(DeploymentAdminNotFoundError);
    expect(tenantCalls).toEqual([TENANT]);
  });
});
