import { describe, expect, it } from "vitest";

import {
  ProjectNotFoundError,
  ProjectReadService,
  ProjectValidationError,
  type OrchestrationTenantStore,
} from "./project-read.service";

interface ProjectRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface DeploymentRow {
  id: string;
  tenant_id: string;
  project_id: string;
  status: string;
  created_at: string;
}

function createFakeStore(seed: readonly ProjectRow[] = []): {
  readonly store: OrchestrationTenantStore;
  readonly projects: Map<string, ProjectRow>;
  readonly deployments: DeploymentRow[];
} {
  const projects = new Map<string, ProjectRow>(seed.map((row) => [row.id, row]));
  const deployments: DeploymentRow[] = [];

  const store: OrchestrationTenantStore = {
    async withTenant(_tenantId, operation) {
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
          values: readonly unknown[] = [],
        ) {
          const sql = statement.replace(/\s+/g, " ").trim();

          // The list read selects the same columns as the single read, so
          // the ordered form has to be matched first.
          if (sql.includes("ORDER BY id")) {
            const [queryTenantId, queryWorkspaceId, cursor, limit] = values as [
              string,
              string,
              string | null,
              number,
            ];
            const rows = [...projects.values()]
              .filter(
                (row) =>
                  row.tenant_id === queryTenantId &&
                  row.workspace_id === queryWorkspaceId &&
                  (cursor === null || row.id > cursor),
              )
              .sort((left, right) => left.id.localeCompare(right.id))
              .slice(0, limit);
            return {
              rowCount: rows.length,
              rows: rows as unknown as readonly TRow[],
            };
          }

          if (sql.startsWith("SELECT id, tenant_id, workspace_id")) {
            const [queryTenantId, projectId] = values as [string, string];
            const row = projects.get(projectId);
            if (row === undefined || row.tenant_id !== queryTenantId) {
              return { rowCount: 0, rows: [] as unknown as readonly TRow[] };
            }
            return { rowCount: 1, rows: [row] as unknown as readonly TRow[] };
          }

          if (sql.startsWith("SELECT id FROM projects")) {
            const [queryTenantId, projectId] = values as [string, string];
            const row = projects.get(projectId);
            if (row === undefined || row.tenant_id !== queryTenantId) {
              return { rowCount: 0, rows: [] as unknown as readonly TRow[] };
            }
            return { rowCount: 1, rows: [{ id: row.id }] as unknown as readonly TRow[] };
          }

          if (sql.startsWith("INSERT INTO deployments")) {
            const [deploymentId, tenantId, projectId] = values as [string, string, string];
            const deployment: DeploymentRow = {
              id: deploymentId,
              tenant_id: tenantId,
              project_id: projectId,
              status: "pending",
              created_at: "2026-01-01T00:00:00Z",
            };
            deployments.push(deployment);
            return { rowCount: 1, rows: [deployment] as unknown as readonly TRow[] };
          }

          throw new Error(`Unexpected query in fake store: ${sql}`);
        },
      });
    },
  };

  return { store, projects, deployments };
}

const TENANT_A_BARE = "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const TENANT_A = `ten_${TENANT_A_BARE}`;
const TENANT_B = "ten_018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "proj_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaab";

function seedRow(): ProjectRow {
  return {
    id: PROJECT_A,
    tenant_id: TENANT_A_BARE,
    workspace_id: "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac",
    name: "Original Project",
    status: "draft",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const WORKSPACE_A_BARE = "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac";
const WORKSPACE_A = `ws_${WORKSPACE_A_BARE}`;
const WORKSPACE_B = "ws_018f4d6e-cccc-7ccc-8ccc-cccccccccccc";

function listRow(id: string, overrides: Partial<ProjectRow> = {}): ProjectRow {
  return { ...seedRow(), id, name: `Project ${id}`, ...overrides };
}

describe("ProjectReadService.listProjects", () => {
  const first = listRow("prj_018f4d6e-aaaa-7aaa-8aaa-000000000001");
  const second = listRow("prj_018f4d6e-aaaa-7aaa-8aaa-000000000002");
  const third = listRow("prj_018f4d6e-aaaa-7aaa-8aaa-000000000003");

  it("returns this workspace's projects in creation order", async () => {
    const { store } = createFakeStore([third, first, second]);
    const service = new ProjectReadService(store);

    const page = await service.listProjects(TENANT_A, WORKSPACE_A, undefined, 50);

    expect(page.data.map((project) => project.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(page.page).toEqual({ next_cursor: null, has_more: false, limit: 50 });
  });

  it("pages with the last id it returned, and says so", async () => {
    const { store } = createFakeStore([first, second, third]);
    const service = new ProjectReadService(store);

    const firstPage = await service.listProjects(TENANT_A, WORKSPACE_A, undefined, 2);
    expect(firstPage.data.map((project) => project.id)).toEqual([first.id, second.id]);
    expect(firstPage.page).toEqual({
      next_cursor: second.id,
      has_more: true,
      limit: 2,
    });

    const secondPage = await service.listProjects(
      TENANT_A,
      WORKSPACE_A,
      firstPage.page.next_cursor ?? undefined,
      2,
    );
    expect(secondPage.data.map((project) => project.id)).toEqual([third.id]);
    expect(secondPage.page.has_more).toBe(false);
  });

  it("never returns another workspace's projects inside the same tenant", async () => {
    const { store } = createFakeStore([first, second]);
    const service = new ProjectReadService(store);

    const page = await service.listProjects(TENANT_A, WORKSPACE_B, undefined, 50);

    expect(page.data).toEqual([]);
  });

  it("never returns another tenant's projects", async () => {
    const { store } = createFakeStore([first, second]);
    const service = new ProjectReadService(store);

    const page = await service.listProjects(TENANT_B, WORKSPACE_A, undefined, 50);

    expect(page.data).toEqual([]);
  });

  it.each([0, 201, 1.5])("refuses limit %s", async (limit) => {
    const { store } = createFakeStore([first]);
    const service = new ProjectReadService(store);

    await expect(
      service.listProjects(TENANT_A, WORKSPACE_A, undefined, limit),
    ).rejects.toBeInstanceOf(ProjectValidationError);
  });

  it("refuses a cursor that is not a project id", async () => {
    const { store } = createFakeStore([first]);
    const service = new ProjectReadService(store);

    await expect(
      service.listProjects(TENANT_A, WORKSPACE_A, "run_something", 50),
    ).rejects.toBeInstanceOf(ProjectValidationError);
  });

  it("refuses a workspace id that is not one", async () => {
    const { store } = createFakeStore([first]);
    const service = new ProjectReadService(store);

    await expect(
      service.listProjects(TENANT_A, WORKSPACE_A_BARE, undefined, 50),
    ).rejects.toBeInstanceOf(ProjectValidationError);
  });
});

describe("ProjectReadService", () => {
  it("returns the real project row for its own tenant", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new ProjectReadService(store);

    const project = await service.getProject(TENANT_A, PROJECT_A);

    expect(project.id).toBe(PROJECT_A);
    expect(project.name).toBe("Original Project");
  });

  it("real cross-tenant read is not_found, never leaks the other tenant's row", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new ProjectReadService(store);

    await expect(service.getProject(TENANT_B, PROJECT_A)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it("creates a real deployment row for its own tenant's project", async () => {
    const { store, deployments } = createFakeStore([seedRow()]);
    const service = new ProjectReadService(store);

    const deployment = await service.createDeployment(TENANT_A, PROJECT_A);

    expect(deployment.projectId).toBe(PROJECT_A);
    expect(deployment.status).toBe("pending");
    expect(deployments).toHaveLength(1);
  });

  it("real cross-tenant deploy is not_found, never creates a deployment row", async () => {
    const { store, deployments } = createFakeStore([seedRow()]);
    const service = new ProjectReadService(store);

    await expect(service.createDeployment(TENANT_B, PROJECT_A)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    expect(deployments).toHaveLength(0);
  });

  it("rejects an empty tenantId", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new ProjectReadService(store);

    await expect(service.getProject("", PROJECT_A)).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
  });

  it("rejects a non-ten_-prefixed tenantId", async () => {
    const { store } = createFakeStore([seedRow()]);
    const service = new ProjectReadService(store);

    await expect(
      service.getProject(TENANT_A_BARE, PROJECT_A),
    ).rejects.toBeInstanceOf(ProjectValidationError);
  });
});
