import { describe, expect, it } from "vitest";

import {
  WorkflowNotFoundError,
  WorkflowReadService,
  WorkflowValidationError,
  type OrchestrationTenantStore,
} from "./workflow-read.service";

interface WorkflowRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function createFakeStore(seed: readonly WorkflowRow[] = []): {
  readonly store: OrchestrationTenantStore;
  readonly workflows: Map<string, WorkflowRow>;
} {
  const workflows = new Map<string, WorkflowRow>(seed.map((row) => [row.id, row]));

  const store: OrchestrationTenantStore = {
    async withTenant(_tenantId, operation) {
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
          values: readonly unknown[] = [],
        ) {
          const sql = statement.replace(/\s+/g, " ").trim();

          if (sql.startsWith("SELECT")) {
            const [queryTenantId, workflowId] = values as [string, string];
            const row = workflows.get(workflowId);
            if (row === undefined || row.tenant_id !== queryTenantId) {
              return { rowCount: 0, rows: [] as unknown as readonly TRow[] };
            }
            return { rowCount: 1, rows: [row] as unknown as readonly TRow[] };
          }

          if (sql.startsWith("INSERT")) {
            const [workflowId, tenantId, workspaceId, name] = values as [
              string,
              string,
              string,
              string,
            ];
            const row: WorkflowRow = {
              id: workflowId,
              tenant_id: tenantId,
              workspace_id: workspaceId,
              name,
              status: "draft",
              created_at: "created",
              updated_at: "created",
            };
            workflows.set(workflowId, row);
            return { rowCount: 1, rows: [row] as unknown as readonly TRow[] };
          }

          if (sql.startsWith("UPDATE")) {
            const [queryTenantId, workflowId, name, status] = values as [
              string,
              string,
              string | null,
              string | null,
            ];
            const row = workflows.get(workflowId);
            if (row === undefined || row.tenant_id !== queryTenantId) {
              return { rowCount: 0, rows: [] as unknown as readonly TRow[] };
            }
            const updated: WorkflowRow = {
              ...row,
              name: name ?? row.name,
              status: status ?? row.status,
              updated_at: "updated",
            };
            workflows.set(workflowId, updated);
            return { rowCount: 1, rows: [updated] as unknown as readonly TRow[] };
          }

          throw new Error(`Unexpected query in fake store: ${sql}`);
        },
      });
    },
  };

  return { store, workflows };
}

const TENANT_A_BARE = "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const TENANT_A = `ten_${TENANT_A_BARE}`;
const TENANT_B = "ten_018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
const WORKSPACE_A = "ws_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac";
const WORKFLOW_A = "wf_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaab";

function seedRow(): WorkflowRow {
  return {
    id: WORKFLOW_A,
    tenant_id: TENANT_A_BARE,
    workspace_id: "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac",
    name: "Original Name",
    status: "draft",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("WorkflowReadService", () => {
  it("creates a real draft workflow in the authenticated tenant and workspace", async () => {
    const { store, workflows } = createFakeStore();
    const service = new WorkflowReadService(store);

    const workflow = await service.createWorkflow({
      tenantId: TENANT_A,
      workspaceId: WORKSPACE_A,
      name: "Discovery follow-up",
    });

    expect(workflow.id).toMatch(/^wf_[0-9a-f-]{36}$/);
    expect(workflow.status).toBe("draft");
    expect(workflow.tenantId).toBe(TENANT_A_BARE);
    expect(workflow.workspaceId).toBe(WORKSPACE_A.slice("ws_".length));
    expect(workflows.get(workflow.id)).toMatchObject({ status: "draft", name: "Discovery follow-up" });
  });

  it("rejects a workspace outside the authenticated ID contract", async () => {
    const { store } = createFakeStore();
    const service = new WorkflowReadService(store);

    await expect(
      service.createWorkflow({ tenantId: TENANT_A, workspaceId: "bad", name: "Nope" }),
    ).rejects.toBeInstanceOf(WorkflowValidationError);
  });

  it("returns the real workflow row for its own tenant", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new WorkflowReadService(store);

    const workflow = await service.getWorkflow(TENANT_A, WORKFLOW_A);

    expect(workflow.id).toBe(WORKFLOW_A);
    expect(workflow.name).toBe("Original Name");
  });

  it("real cross-tenant read is not_found, never leaks the other tenant's row", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new WorkflowReadService(store);

    await expect(service.getWorkflow(TENANT_B, WORKFLOW_A)).rejects.toBeInstanceOf(
      WorkflowNotFoundError,
    );
  });

  it("updates name and status for its own tenant", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new WorkflowReadService(store);

    const updated = await service.updateWorkflow({
      tenantId: TENANT_A,
      workflowId: WORKFLOW_A,
      name: "Renamed",
      status: "active",
    });

    expect(updated.name).toBe("Renamed");
    expect(updated.status).toBe("active");
  });

  it("real cross-tenant update is not_found, never mutates the other tenant's row", async () => {
    const { store, workflows } = createFakeStore([seedRow()]);
    const service = new WorkflowReadService(store);

    await expect(
      service.updateWorkflow({ tenantId: TENANT_B, workflowId: WORKFLOW_A, name: "Hijacked" }),
    ).rejects.toBeInstanceOf(WorkflowNotFoundError);
    expect(workflows.get(WORKFLOW_A)?.name).toBe("Original Name");
  });

  it("rejects an invalid status", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new WorkflowReadService(store);

    await expect(
      service.updateWorkflow({
        tenantId: TENANT_A,
        workflowId: WORKFLOW_A,
        status: "bogus" as never,
      }),
    ).rejects.toBeInstanceOf(WorkflowValidationError);
  });

  it("rejects an empty tenantId", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new WorkflowReadService(store);

    await expect(service.getWorkflow("", WORKFLOW_A)).rejects.toBeInstanceOf(
      WorkflowValidationError,
    );
  });
});
