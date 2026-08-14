import { describe, expect, it } from "vitest";

import {
  DeploymentConcurrencyError,
  DeploymentControllerService,
  DeploymentNotFoundError,
  DeploymentStateTransitionError,
  DeploymentValidationError,
  type OrchestrationTenantStore,
} from "./deployment-controller.service";
import type { EvalFacadeService } from "../eval-facade/eval-facade.service";

// promoteVersion/startCanary gate on a real release-gate check
// (59ad276) -- these tests exercise the deployment state machine, not the
// gate itself, so this fake always passes.
const PASSING_EVAL_FACADE: EvalFacadeService = {
  runEvaluation: async () => ({
    evaluation_run_id: "evr_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
    status: "completed",
    results_json: "{}",
  }),
  checkReleaseGate: async () => ({ passed: true, failed_thresholds: [] }),
} as unknown as EvalFacadeService;

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_TENANT_ID = TENANT_ID.slice("ten_".length);
const WORKFLOW_ID = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const VERSION_1 = "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const VERSION_2 = "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const PROMOTED_AT = new Date("2026-07-26T10:00:00.000Z");

type Status = "compiled" | "canary" | "promoted" | "rolled_back" | "retired";

interface FakeVersion {
  readonly id: string;
  status: Status;
  trafficPercent: number | null;
}

function createFakeStore(
  initialVersions: readonly FakeVersion[],
  options: { claimFailures?: number; workflowExists?: boolean } = {},
): {
  readonly store: OrchestrationTenantStore;
  readonly versions: FakeVersion[];
  readonly tenantCalls: string[];
} {
  const versions = initialVersions.map((version) => ({ ...version }));
  const tenantCalls: string[] = [];
  let claimFailures = options.claimFailures ?? 0;
  let revision = 1;

  const store: OrchestrationTenantStore = {
    async withTenant(tenantId, operation) {
      tenantCalls.push(tenantId);
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
          values: readonly unknown[] = [],
        ) {
          const sql = statement.replace(/\s+/g, " ").trim();

          if (sql.startsWith("SELECT xmin::text AS revision FROM workflows")) {
            const rows = options.workflowExists === false
              ? []
              : [{ revision: String(revision) }];
            return {
              rowCount: rows.length,
              rows: rows as unknown as readonly TRow[],
            };
          }

          if (sql.startsWith("SELECT id, status FROM workflow_versions")) {
            const targetVersionId = values[2] as string;
            const rows = versions
              .filter(
                (version) =>
                  version.id === targetVersionId ||
                  version.status === "promoted" ||
                  version.status === "canary",
              )
              .map(({ id, status }) => ({ id, status }));
            return {
              rowCount: rows.length,
              rows: rows as unknown as readonly TRow[],
            };
          }

          if (sql.startsWith("UPDATE workflows SET updated_at")) {
            if (claimFailures > 0) {
              claimFailures -= 1;
              return { rowCount: 0, rows: [] as readonly TRow[] };
            }
            revision += 1;
            return { rowCount: 1, rows: [] as readonly TRow[] };
          }

          const versionId = values[2] as string;
          const version = versions.find((candidate) => candidate.id === versionId);

          if (sql.includes("SET status = 'retired'")) {
            if (version?.status !== "promoted") {
              return { rowCount: 0, rows: [] as readonly TRow[] };
            }
            version.status = "retired";
            version.trafficPercent = null;
            return { rowCount: 1, rows: [] as readonly TRow[] };
          }

          if (sql.includes("SET status = 'canary'")) {
            if (version?.status !== "compiled") {
              return { rowCount: 0, rows: [] as readonly TRow[] };
            }
            version.status = "canary";
            version.trafficPercent = values[3] as number;
            return { rowCount: 1, rows: [] as readonly TRow[] };
          }

          if (sql.includes("SET status = 'rolled_back'")) {
            if (version?.status !== "promoted") {
              return { rowCount: 0, rows: [] as readonly TRow[] };
            }
            version.status = "rolled_back";
            version.trafficPercent = null;
            return { rowCount: 1, rows: [] as readonly TRow[] };
          }

          if (sql.includes("SET status = 'promoted'")) {
            const expectedStatus = (values[3] ?? "retired") as Status;
            if (version?.status !== expectedStatus) {
              return { rowCount: 0, rows: [] as readonly TRow[] };
            }
            version.status = "promoted";
            version.trafficPercent = null;
            const rows = sql.includes("RETURNING")
              ? [{ promoted_at: PROMOTED_AT }]
              : [];
            return {
              rowCount: 1,
              rows: rows as unknown as readonly TRow[],
            };
          }

          throw new Error(`Unhandled fake query: ${sql}`);
        },
      });
    },
  };

  return { store, versions, tenantCalls };
}

function version(
  id: string,
  status: Status,
  trafficPercent: number | null = null,
): FakeVersion {
  return { id, status, trafficPercent };
}

describe("DeploymentControllerService", () => {
  it("promotes a compiled version and routinely retires the old live version", async () => {
    const { store, versions, tenantCalls } = createFakeStore([
      version(VERSION_1, "promoted"),
      version(VERSION_2, "compiled"),
    ]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    const result = await service.promoteVersion({
      tenant_id: TENANT_ID,
      workflow_id: WORKFLOW_ID,
      workflow_version_id: VERSION_2,
    });

    expect(result).toEqual({
      status: "promoted",
      promoted_at: PROMOTED_AT.toISOString(),
    });
    expect(versions).toEqual([
      version(VERSION_1, "retired"),
      version(VERSION_2, "promoted"),
    ]);
    expect(tenantCalls).toEqual([BARE_TENANT_ID]);
  });

  it("persists canary traffic without changing the stable promoted version", async () => {
    const { store, versions } = createFakeStore([
      version(VERSION_1, "promoted"),
      version(VERSION_2, "compiled"),
    ]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.startCanary({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
        traffic_percent: 15,
      }),
    ).resolves.toEqual({ status: "canary", traffic_percent: 15 });
    expect(versions).toEqual([
      version(VERSION_1, "promoted"),
      version(VERSION_2, "canary", 15),
    ]);
  });

  it("promotes a canary and clears its partial-traffic allocation", async () => {
    const { store, versions } = createFakeStore([
      version(VERSION_1, "promoted"),
      version(VERSION_2, "canary", 15),
    ]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.promoteVersion({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
      }),
    ).resolves.toMatchObject({ status: "promoted" });
    expect(versions).toEqual([
      version(VERSION_1, "retired"),
      version(VERSION_2, "promoted"),
    ]);
  });

  it("rejects a second simultaneous canary allocation", async () => {
    const { store, versions } = createFakeStore([
      version(VERSION_1, "canary", 15),
      version(VERSION_2, "compiled"),
    ]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.startCanary({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
        traffic_percent: 20,
      }),
    ).rejects.toThrow(DeploymentStateTransitionError);
    expect(versions).toEqual([
      version(VERSION_1, "canary", 15),
      version(VERSION_2, "compiled"),
    ]);
  });

  it("marks the failed live version rolled_back and restores only a retired target", async () => {
    const { store, versions } = createFakeStore([
      version(VERSION_1, "retired"),
      version(VERSION_2, "promoted"),
    ]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.rollbackVersion({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        target_version_id: VERSION_1,
      }),
    ).resolves.toEqual({
      status: "rolled_back",
      active_version_id: VERSION_1,
    });
    expect(versions).toEqual([
      version(VERSION_1, "promoted"),
      version(VERSION_2, "rolled_back"),
    ]);
  });

  it("rejects promoting a retired version", async () => {
    const { store } = createFakeStore([version(VERSION_2, "retired")]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.promoteVersion({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
      }),
    ).rejects.toThrow(DeploymentStateTransitionError);
  });

  it("rejects rolling back to a canary version", async () => {
    const { store } = createFakeStore([
      version(VERSION_1, "canary", 10),
      version(VERSION_2, "promoted"),
    ]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.rollbackVersion({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        target_version_id: VERSION_1,
      }),
    ).rejects.toThrow(DeploymentStateTransitionError);
  });

  it.each([0, 100, 1.5])("rejects invalid canary traffic %s", async (traffic) => {
    const { store } = createFakeStore([version(VERSION_2, "compiled")]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.startCanary({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
        traffic_percent: traffic,
      }),
    ).rejects.toThrow(DeploymentValidationError);
  });

  it("rejects malformed tenant/workflow/version identifiers", async () => {
    const { store } = createFakeStore([version(VERSION_2, "compiled")]);
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.promoteVersion({
        tenant_id: "tenant-bad",
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
      }),
    ).rejects.toThrow(DeploymentValidationError);
    await expect(
      service.promoteVersion({
        tenant_id: TENANT_ID,
        workflow_id: "workflow-bad",
        workflow_version_id: VERSION_2,
      }),
    ).rejects.toThrow(DeploymentValidationError);
    await expect(
      service.promoteVersion({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: "version-bad",
      }),
    ).rejects.toThrow(DeploymentValidationError);
  });

  it("fails with a typed not-found error when tenant scope cannot see the workflow", async () => {
    const { store } = createFakeStore([], { workflowExists: false });
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.promoteVersion({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
      }),
    ).rejects.toThrow(DeploymentNotFoundError);
  });

  it("retries optimistic write conflicts and succeeds within the bound", async () => {
    const { store, tenantCalls } = createFakeStore(
      [version(VERSION_2, "compiled")],
      { claimFailures: 2 },
    );
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.promoteVersion({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
      }),
    ).resolves.toMatchObject({ status: "promoted" });
    expect(tenantCalls).toHaveLength(3);
  });

  it("throws a bounded concurrency error after three failed claims", async () => {
    const { store, tenantCalls } = createFakeStore(
      [version(VERSION_2, "compiled")],
      { claimFailures: 3 },
    );
    const service = new DeploymentControllerService(store, PASSING_EVAL_FACADE);

    await expect(
      service.promoteVersion({
        tenant_id: TENANT_ID,
        workflow_id: WORKFLOW_ID,
        workflow_version_id: VERSION_2,
      }),
    ).rejects.toThrow(DeploymentConcurrencyError);
    expect(tenantCalls).toHaveLength(3);
  });
});
