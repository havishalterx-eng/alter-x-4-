import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";
import {
  createMockObjectStorageProvider,
  type ObjectStorageProvider,
} from "@alterx/shared-clients";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ArtifactsService } from "../artifacts/artifacts.service";
import {
  DeploymentControllerService,
  DeploymentNotFoundError,
} from "./deployment-controller.service";
import type { EvalFacadeService } from "../eval-facade/eval-facade.service";

// This suite only exercises deployProjectArtifact, which doesn't touch the
// release gate (59ad276 added evalFacade to promoteVersion/startCanary
// only) -- fake is never called, just satisfies the constructor.
const PASSING_EVAL_FACADE: EvalFacadeService = {
  runEvaluation: async () => ({
    evaluation_run_id: "evr_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
    status: "completed",
    results_json: "{}",
  }),
  checkReleaseGate: async () => ({ passed: true, failed_thresholds: [] }),
} as unknown as EvalFacadeService;

const migrationsFolder = resolve(
  process.cwd(),
  "apps/orchestration-service/drizzle",
);
const TENANT_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const TENANT_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b1";
const TENANT_A_REQUEST = `ten_${TENANT_A}`;
const TENANT_B_REQUEST = `ten_${TENANT_B}`;
const WORKSPACE_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const WORKSPACE_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b2";
const PROJECT_A = "prj_018f4d6e-2b4a-7a3e-8c1a-1234567890a3";
const PROJECT_B = "prj_018f4d6e-2b4a-7a3e-8c1a-1234567890b3";
const WORKFLOW_A = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890a4";
const WORKFLOW_B = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890b4";
const RUN_A = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890a5";
const RUN_B = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890b5";
const SOURCE_BUCKET = "project-build-artifacts";
const DEPLOYMENT_BUCKET = "project-static-publish";

interface DeploymentRow extends Record<string, unknown> {
  readonly id: string;
  readonly artifact_id: string | null;
  readonly destination_reference: string | null;
  readonly status: "pending" | "active" | "failed" | "rolled_back";
}

describe.sequential("project artifact deployment seam", () => {
  let container: StartedPostgreSqlContainer;
  let store: PostgresOrchestrationStoreProvider;
  let objects: ReturnType<typeof createMockObjectStorageProvider>;
  let artifacts: ArtifactsService;
  let service: DeploymentControllerService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16.6-alpine")
      .withDatabase("orchestration_db")
      .withUsername("artifact_deployment_test")
      .withPassword(randomBytes(24).toString("hex"))
      .start();
    store = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: container.getConnectionUri(),
      migrationsFolder,
    });
    await store.migrate();
  }, 60_000);

  afterAll(async () => {
    await store?.close();
    await container?.stop();
  }, 60_000);

  beforeEach(async () => {
    objects = createMockObjectStorageProvider();
    artifacts = new ArtifactsService(store, objects, SOURCE_BUCKET);
    service = new DeploymentControllerService(store, PASSING_EVAL_FACADE, {
      artifacts,
      objects,
      staticDeploymentBucket: DEPLOYMENT_BUCKET,
    });
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await store.withTenant(tenantId, async (tx) => {
        await tx.query("DELETE FROM deployments WHERE tenant_id = $1", [tenantId]);
        await tx.query("DELETE FROM artifacts WHERE tenant_id = $1", [tenantId]);
        await tx.query("DELETE FROM runs WHERE tenant_id = $1", [tenantId]);
        await tx.query("DELETE FROM workflows WHERE tenant_id = $1", [tenantId]);
        await tx.query("DELETE FROM projects WHERE tenant_id = $1", [tenantId]);
      });
    }
    await seedTenant(TENANT_A, WORKSPACE_A, PROJECT_A, WORKFLOW_A, RUN_A);
    await seedTenant(TENANT_B, WORKSPACE_B, PROJECT_B, WORKFLOW_B, RUN_B);
  });

  async function seedTenant(
    tenantId: string,
    workspaceId: string,
    projectId: string,
    workflowId: string,
    runId: string,
  ): Promise<void> {
    await store.withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO projects (id, tenant_id, workspace_id, name, status)
         VALUES ($1, $2, $3, 'Static export', 'active')`,
        [projectId, tenantId, workspaceId],
      );
      await tx.query(
        `INSERT INTO workflows (id, tenant_id, workspace_id, name)
         VALUES ($1, $2, $3, 'Artifact source workflow')`,
        [workflowId, tenantId, workspaceId],
      );
      await tx.query(
        `INSERT INTO runs (id, tenant_id, workspace_id, parent_kind, workflow_id, status)
         VALUES ($1, $2, $3, 'workflow', $4, 'completed')`,
        [runId, tenantId, workspaceId, workflowId],
      );
    });
  }

  async function deploymentsFor(
    tenantId: string,
    projectId: string,
  ): Promise<readonly DeploymentRow[]> {
    return store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<DeploymentRow>(
        `SELECT id, artifact_id, destination_reference, status
         FROM deployments
         WHERE tenant_id = $1 AND project_id = $2
         ORDER BY created_at, id`,
        [tenantId, projectId],
      );
      return result.rows;
    });
  }

  it("writes real artifact bytes before recording the deployment as active", async () => {
    const bytes = new TextEncoder().encode("<main>first project build</main>");
    const artifact = await artifacts.create(TENANT_A_REQUEST, {
      runId: RUN_A,
      contentType: "text/html",
      bytes,
    });

    const deployed = await service.deployProjectArtifact({
      tenantId: TENANT_A_REQUEST,
      projectId: PROJECT_A,
      artifactId: artifact.id,
    });

    expect(deployed.status).toBe("active");
    expect(deployed.destinationReference).toBe(
      `s3://${DEPLOYMENT_BUCKET}/tenants/${TENANT_A}/projects/${PROJECT_A}/deployments/${deployed.id}/artifacts/${artifact.id}`,
    );
    await expect(objects.getObject(deployed.destinationReference)).resolves.toEqual(
      Buffer.from(bytes),
    );
    expect(await deploymentsFor(TENANT_A, PROJECT_A)).toEqual([
      expect.objectContaining({
        id: deployed.id,
        artifact_id: artifact.id,
        destination_reference: deployed.destinationReference,
        status: "active",
      }),
    ]);
  });

  it("rolls a previous static publish back only after the replacement object exists", async () => {
    const first = await artifacts.create(TENANT_A_REQUEST, {
      runId: RUN_A,
      contentType: "text/html",
      bytes: new TextEncoder().encode("first"),
    });
    const firstDeployment = await service.deployProjectArtifact({
      tenantId: TENANT_A_REQUEST,
      projectId: PROJECT_A,
      artifactId: first.id,
    });
    const second = await artifacts.create(TENANT_A_REQUEST, {
      runId: RUN_A,
      contentType: "text/html",
      bytes: new TextEncoder().encode("second"),
    });

    const secondDeployment = await service.deployProjectArtifact({
      tenantId: TENANT_A_REQUEST,
      projectId: PROJECT_A,
      artifactId: second.id,
    });

    await expect(objects.getObject(secondDeployment.destinationReference)).resolves.toEqual(
      Buffer.from("second"),
    );
    expect(await deploymentsFor(TENANT_A, PROJECT_A)).toEqual([
      expect.objectContaining({ id: firstDeployment.id, status: "rolled_back" }),
      expect.objectContaining({ id: secondDeployment.id, status: "active" }),
    ]);
  });

  it("marks the durable record failed when static S3 publishing fails", async () => {
    const artifact = await artifacts.create(TENANT_A_REQUEST, {
      runId: RUN_A,
      contentType: "text/html",
      bytes: new TextEncoder().encode("will not publish"),
    });
    const failingObjects: ObjectStorageProvider = {
      ...objects,
      putObject: async (reference, body, contentType) => {
        if (reference.startsWith(`s3://${DEPLOYMENT_BUCKET}/`)) {
          throw new Error("S3 publish unavailable");
        }
        await objects.putObject(reference, body, contentType);
      },
    };
    const failingService = new DeploymentControllerService(store, PASSING_EVAL_FACADE, {
      artifacts,
      objects: failingObjects,
      staticDeploymentBucket: DEPLOYMENT_BUCKET,
    });

    await expect(
      failingService.deployProjectArtifact({
        tenantId: TENANT_A_REQUEST,
        projectId: PROJECT_A,
        artifactId: artifact.id,
      }),
    ).rejects.toThrow("S3 publish unavailable");
    expect(await deploymentsFor(TENANT_A, PROJECT_A)).toEqual([
      expect.objectContaining({ artifact_id: artifact.id, status: "failed" }),
    ]);
  });

  it("never deploys an artifact owned by another tenant", async () => {
    const tenantBArtifact = await artifacts.create(TENANT_B_REQUEST, {
      runId: RUN_B,
      contentType: "text/html",
      bytes: new TextEncoder().encode("tenant B only"),
    });

    await expect(
      service.deployProjectArtifact({
        tenantId: TENANT_A_REQUEST,
        projectId: PROJECT_A,
        artifactId: tenantBArtifact.id,
      }),
    ).rejects.toThrow(DeploymentNotFoundError);
    expect(await deploymentsFor(TENANT_A, PROJECT_A)).toEqual([]);
    expect(await deploymentsFor(TENANT_B, PROJECT_B)).toEqual([]);
  });
});
