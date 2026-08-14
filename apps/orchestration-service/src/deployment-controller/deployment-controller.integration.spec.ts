import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";

import {
  DeploymentControllerService,
  DeploymentNotFoundError,
  DeploymentStateTransitionError,
} from "./deployment-controller.service";
import type { EvalFacadeService } from "../eval-facade/eval-facade.service";

// promoteVersion/startCanary gate on a real release-gate check
// (59ad276) -- this suite exercises the Postgres-backed state machine, not
// the gate itself, so this fake always passes.
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
const WORKSPACE_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const WORKSPACE_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b2";
const WORKFLOW_A = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890a3";
const WORKFLOW_B = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890b3";
const VERSION_1 = "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890a4";
const VERSION_2 = "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890a5";
const VERSION_3 = "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890a6";
const VERSION_B = "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890b4";

type VersionStatus =
  | "compiled"
  | "canary"
  | "promoted"
  | "rolled_back"
  | "retired";

interface SeedVersion {
  readonly id: string;
  readonly status: VersionStatus;
  readonly trafficPercent?: number;
}

interface StoredVersion extends Record<string, unknown> {
  readonly id: string;
  readonly status: VersionStatus;
  readonly traffic_percent: number | null;
}

describe.sequential("DeploymentControllerService Postgres integration", () => {
  let container: StartedPostgreSqlContainer;
  let store: PostgresOrchestrationStoreProvider;
  let service: DeploymentControllerService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16.6-alpine")
      .withDatabase("orchestration_db")
      .withUsername("deployment_controller_test")
      .withPassword(randomBytes(24).toString("hex"))
      .start();
    store = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: container.getConnectionUri(),
      migrationsFolder,
    });
    await store.migrate();
    service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);
  }, 60_000);

  afterAll(async () => {
    await store?.close();
    await container?.stop();
  }, 60_000);

  beforeEach(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await store.withTenant(tenantId, async (tx) => {
        await tx.query("DELETE FROM workflow_versions WHERE tenant_id = $1", [
          tenantId,
        ]);
        await tx.query("DELETE FROM workflows WHERE tenant_id = $1", [tenantId]);
      });
    }
  });

  async function seedWorkflow(
    tenantId: string,
    workspaceId: string,
    workflowId: string,
    versions: readonly SeedVersion[],
  ): Promise<void> {
    await store.withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO workflows (id, tenant_id, workspace_id, name)
         VALUES ($1, $2, $3, 'Deployment test workflow')`,
        [workflowId, tenantId, workspaceId],
      );
      for (const [index, version] of versions.entries()) {
        await tx.query(
          `INSERT INTO workflow_versions
             (id, tenant_id, workflow_id, version, compiled_dag,
              dag_schema_version, status, traffic_percent)
           VALUES ($1, $2, $3, $4, '{}'::jsonb, 'v1', $5, $6)`,
          [
            version.id,
            tenantId,
            workflowId,
            index + 1,
            version.status,
            version.trafficPercent ?? null,
          ],
        );
      }
    });
  }

  async function storedVersions(
    tenantId = TENANT_A,
    workflowId = WORKFLOW_A,
  ): Promise<readonly StoredVersion[]> {
    return store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<StoredVersion>(
        `SELECT id, status, traffic_percent
         FROM workflow_versions
         WHERE tenant_id = $1 AND workflow_id = $2
         ORDER BY version`,
        [tenantId, workflowId],
      );
      return result.rows;
    });
  }

  it("promotes atomically and marks routine supersession retired", async () => {
    await seedWorkflow(TENANT_A, WORKSPACE_A, WORKFLOW_A, [
      { id: VERSION_1, status: "promoted" },
      { id: VERSION_2, status: "compiled" },
    ]);

    const startedAt = Date.now();
    const result = await service.promoteVersion({
      tenant_id: TENANT_A_REQUEST,
      workflow_id: WORKFLOW_A,
      workflow_version_id: VERSION_2,
    });

    expect(result.status).toBe("promoted");
    expect(new Date(result.promoted_at).toISOString()).toBe(result.promoted_at);
    expect(new Date(result.promoted_at).getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(new Date(result.promoted_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await storedVersions()).toEqual([
      { id: VERSION_1, status: "retired", traffic_percent: null },
      { id: VERSION_2, status: "promoted", traffic_percent: null },
    ]);
  });

  it("persists canary traffic while leaving the stable version promoted", async () => {
    await seedWorkflow(TENANT_A, WORKSPACE_A, WORKFLOW_A, [
      { id: VERSION_1, status: "promoted" },
      { id: VERSION_2, status: "compiled" },
    ]);

    await expect(
      service.startCanary({
        tenant_id: TENANT_A_REQUEST,
        workflow_id: WORKFLOW_A,
        workflow_version_id: VERSION_2,
        traffic_percent: 20,
      }),
    ).resolves.toEqual({ status: "canary", traffic_percent: 20 });
    expect(await storedVersions()).toEqual([
      { id: VERSION_1, status: "promoted", traffic_percent: null },
      { id: VERSION_2, status: "canary", traffic_percent: 20 },
    ]);
  });

  it("rejects a second canary so traffic routing stays unambiguous", async () => {
    await seedWorkflow(TENANT_A, WORKSPACE_A, WORKFLOW_A, [
      { id: VERSION_1, status: "promoted" },
      { id: VERSION_2, status: "canary", trafficPercent: 20 },
      { id: VERSION_3, status: "compiled" },
    ]);

    await expect(
      service.startCanary({
        tenant_id: TENANT_A_REQUEST,
        workflow_id: WORKFLOW_A,
        workflow_version_id: VERSION_3,
        traffic_percent: 10,
      }),
    ).rejects.toThrow(DeploymentStateTransitionError);
    expect(await storedVersions()).toEqual([
      { id: VERSION_1, status: "promoted", traffic_percent: null },
      { id: VERSION_2, status: "canary", traffic_percent: 20 },
      { id: VERSION_3, status: "compiled", traffic_percent: null },
    ]);
  });

  it("distinguishes incident rollback from routine retirement", async () => {
    await seedWorkflow(TENANT_A, WORKSPACE_A, WORKFLOW_A, [
      { id: VERSION_1, status: "retired" },
      { id: VERSION_2, status: "promoted" },
    ]);

    await expect(
      service.rollbackVersion({
        tenant_id: TENANT_A_REQUEST,
        workflow_id: WORKFLOW_A,
        target_version_id: VERSION_1,
      }),
    ).resolves.toEqual({
      status: "rolled_back",
      active_version_id: VERSION_1,
    });
    expect(await storedVersions()).toEqual([
      { id: VERSION_1, status: "promoted", traffic_percent: null },
      { id: VERSION_2, status: "rolled_back", traffic_percent: null },
    ]);
  });

  it("rejects illegal retired promotion and canary rollback target transitions", async () => {
    await seedWorkflow(TENANT_A, WORKSPACE_A, WORKFLOW_A, [
      { id: VERSION_1, status: "retired" },
      { id: VERSION_2, status: "promoted" },
      { id: VERSION_3, status: "canary", trafficPercent: 10 },
    ]);

    await expect(
      service.promoteVersion({
        tenant_id: TENANT_A_REQUEST,
        workflow_id: WORKFLOW_A,
        workflow_version_id: VERSION_1,
      }),
    ).rejects.toThrow(DeploymentStateTransitionError);
    await expect(
      service.rollbackVersion({
        tenant_id: TENANT_A_REQUEST,
        workflow_id: WORKFLOW_A,
        target_version_id: VERSION_3,
      }),
    ).rejects.toThrow(DeploymentStateTransitionError);
  });

  it("cannot read or mutate another tenant's workflow version", async () => {
    await seedWorkflow(TENANT_B, WORKSPACE_B, WORKFLOW_B, [
      { id: VERSION_B, status: "compiled" },
    ]);

    await expect(
      service.promoteVersion({
        tenant_id: TENANT_A_REQUEST,
        workflow_id: WORKFLOW_B,
        workflow_version_id: VERSION_B,
      }),
    ).rejects.toThrow(DeploymentNotFoundError);
    expect(await storedVersions(TENANT_B, WORKFLOW_B)).toEqual([
      { id: VERSION_B, status: "compiled", traffic_percent: null },
    ]);
  });

  it("keeps exactly one promoted version under concurrent promotions", async () => {
    await seedWorkflow(TENANT_A, WORKSPACE_A, WORKFLOW_A, [
      { id: VERSION_1, status: "promoted" },
      { id: VERSION_2, status: "compiled" },
      { id: VERSION_3, status: "compiled" },
    ]);

    const results = await Promise.allSettled([
      service.promoteVersion({
        tenant_id: TENANT_A_REQUEST,
        workflow_id: WORKFLOW_A,
        workflow_version_id: VERSION_2,
      }),
      service.promoteVersion({
        tenant_id: TENANT_A_REQUEST,
        workflow_id: WORKFLOW_A,
        workflow_version_id: VERSION_3,
      }),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const versions = await storedVersions();
    expect(versions.filter((version) => version.status === "promoted")).toHaveLength(1);
  });
});
