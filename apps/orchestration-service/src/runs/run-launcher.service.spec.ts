import { describe, expect, it, vi } from "vitest";
import type { CompiledDag } from "@alterx/contracts";

import {
  RunLauncherService,
  RunNotFoundError,
  RunStartFailedError,
  RunStateConflictError,
  RunValidationError,
  WorkflowNotFoundError,
  type OrchestrationTenantStore,
} from "./run-launcher.service";
import { ProjectRunProvisioningService } from "./project-run-provisioning.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const WORKFLOW = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const WORKFLOW_VERSION = "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const PROJECT = "prj_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const SESSION = "ses_returned-by-provisioning";

function compiledDag(): CompiledDag {
  return {
    schema_version: "v1",
    entry_node_keys: ["node_a"],
    nodes: [
      { key: "node_a", type: "ToolCall", config: {}, metadata: { ui: {} } },
      { key: "node_b", type: "ToolCall", config: {}, metadata: { ui: {} } },
    ],
    edges: [{ key: "e1", from: "node_a", to: "node_b", kind: "sequential" }],
    waves: [
      { key: "wave_0", order: 0, node_keys: ["node_a"], depends_on: [] },
      { key: "wave_1", order: 1, node_keys: ["node_b"], depends_on: ["wave_0"] },
    ],
  };
}

interface FakeTx {
  query: ReturnType<typeof vi.fn>;
}

/** Tiny in-memory tenant store standing in for PostgresOrchestrationStoreProvider. */
function fakeStore(handlers: {
  workflowExists?: boolean;
  promotedVersion?: { readonly id: string; readonly compiled_dag: unknown } | undefined;
  explicitVersion?: { readonly id: string; readonly status: string; readonly compiled_dag: unknown } | undefined;
  runRow?: Record<string, unknown>;
}): { store: OrchestrationTenantStore; tx: FakeTx } {
  const runRow = handlers.runRow ?? {
    id: RUN,
    workflow_id: WORKFLOW,
    workflow_version_id: WORKFLOW_VERSION,
    parent_kind: "workflow",
    status: "pending",
    started_at: null,
    ended_at: null,
    created_at: "2026-07-28T00:00:00.000Z",
  };

  const query = vi.fn(async (statement: string) => {
    if (statement.includes("SELECT id FROM workflows")) {
      return { rowCount: handlers.workflowExists === false ? 0 : 1, rows: [{ id: WORKFLOW }] };
    }
    if (statement.includes("id, status, compiled_dag FROM workflow_versions")) {
      return handlers.explicitVersion === undefined
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [handlers.explicitVersion] };
    }
    if (statement.includes("id, compiled_dag FROM workflow_versions")) {
      return handlers.promotedVersion === undefined
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [handlers.promotedVersion] };
    }
    if (statement.includes("INSERT INTO runs")) {
      return { rowCount: 1, rows: [runRow] };
    }
    if (statement.includes("UPDATE runs SET status = 'running'")) {
      return { rowCount: 1, rows: [{ ...runRow, status: "running", started_at: "2026-07-28T00:00:01.000Z" }] };
    }
    if (statement.includes("SELECT")) {
      return { rowCount: 1, rows: [runRow] };
    }
    return { rowCount: 0, rows: [] };
  });

  const tx: FakeTx = { query };
  const store: OrchestrationTenantStore = {
    withTenant: async (tenantId, operation) => {
      expect(tenantId).toBe(BARE_TENANT);
      return operation(tx as unknown as Parameters<typeof operation>[0]);
    },
  };
  return { store, tx };
}

function projectRunHarness(options: { readonly reused?: boolean } = {}) {
  const runs = new Map<string, Record<string, unknown>>();
  const provision = vi.fn(async () => ({
    session_id: SESSION,
    project_directory: `/workspace/${PROJECT}`,
    reused: options.reused ?? false,
  }));
  const closeCycle = vi.fn(async () => ({ closed: true }));
  const query = vi.fn(async (statement: string, values: readonly unknown[] = []) => {
    if (statement.includes("SELECT workspace_id FROM projects")) {
      return { rowCount: 1, rows: [{ workspace_id: BARE_TENANT }] };
    }
    if (statement.includes("INSERT INTO runs")) {
      const [id, tenantId, workspaceId, projectId, cycleId, templateId] = values as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const row = {
        id,
        workflow_id: null,
        project_id: projectId,
        workflow_version_id: null,
        provisioning_session_id: null,
        provisioning_cycle_id: cycleId,
        provisioning_template_id: templateId,
        provisioning_closed_at: null,
        parent_kind: "project",
        status: "pending",
        started_at: null,
        ended_at: null,
        created_at: "2026-08-05T00:00:00.000Z",
        tenant_id: tenantId,
        workspace_id: workspaceId,
      };
      runs.set(id, row);
      return { rowCount: 1, rows: [row] };
    }
    if (statement.includes("SET provisioning_session_id")) {
      const [, runId, projectId, sessionId, cycleId] = values as [
        string,
        string,
        string,
        string,
        string,
      ];
      const row = runs.get(runId);
      if (
        row === undefined ||
        row.project_id !== projectId ||
        row.provisioning_cycle_id !== cycleId ||
        row.provisioning_session_id !== null
      ) {
        return { rowCount: 0, rows: [] };
      }
      row.provisioning_session_id = sessionId;
      return { rowCount: 1, rows: [] };
    }
    if (statement.includes("SELECT project_id, provisioning_cycle_id")) {
      const [, runId] = values as [string, string];
      const row = runs.get(runId);
      return { rowCount: row === undefined ? 0 : 1, rows: row === undefined ? [] : [row] };
    }
    if (statement.includes("SET provisioning_closed_at")) {
      const [, runId] = values as [string, string];
      const row = runs.get(runId);
      if (row === undefined || row.provisioning_closed_at !== null) {
        return { rowCount: 0, rows: [] };
      }
      row.provisioning_closed_at = "2026-08-05T00:05:00.000Z";
      return { rowCount: 1, rows: [] };
    }
    if (statement.includes("UPDATE runs SET status = 'running'")) {
      const [, runId] = values as [string, string];
      const row = runs.get(runId)!;
      row.status = "running";
      row.started_at = "2026-08-05T00:00:01.000Z";
      return { rowCount: 1, rows: [row] };
    }
    if (statement.includes("UPDATE runs SET status = 'cancelled'")) {
      const [, runId] = values as [string, string];
      const row = runs.get(runId)!;
      row.status = "cancelled";
      row.ended_at = "2026-08-05T00:04:00.000Z";
      return { rowCount: 1, rows: [row] };
    }
    if (statement.includes("UPDATE runs SET status = 'failed'")) {
      const [, runId] = values as [string, string];
      const row = runs.get(runId)!;
      row.status = "failed";
      return { rowCount: 1, rows: [] };
    }
    if (statement.includes("FROM runs")) {
      const [, runId] = values as [string, string];
      const row = runs.get(runId);
      return { rowCount: row === undefined ? 0 : 1, rows: row === undefined ? [] : [row] };
    }
    return { rowCount: 0, rows: [] };
  });
  const store: OrchestrationTenantStore = {
    withTenant: async (tenantId, operation) => {
      expect(tenantId).toBe(BARE_TENANT);
      return operation({ query } as never);
    },
  };
  const lifecycle = new ProjectRunProvisioningService(store, {
    provision,
    closeCycle,
  });
  return { store, runs, provision, closeCycle, lifecycle };
}

describe("RunLauncherService.createRun", () => {
  it("resolves the promoted version, inserts the run, starts the workflow, and marks it running", async () => {
    const { store } = fakeStore({
      workflowExists: true,
      promotedVersion: { id: WORKFLOW_VERSION, compiled_dag: compiledDag() },
    });
    const durable = {
      startWorkflow: vi.fn().mockResolvedValue({ workflowId: RUN, runId: "temporal-run-1" }),
      terminateWorkflow: vi.fn(),
    };
    const launcher = new RunLauncherService(store, durable as never);

    const result = await launcher.createRun(TENANT, WORKFLOW);

    expect(durable.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: RUN, workflowType: "executorWorkflow" }),
    );
    expect(result.status).toBe("running");
  });

  it("rejects when the workflow does not exist", async () => {
    const { store } = fakeStore({ workflowExists: false });
    const durable = { startWorkflow: vi.fn(), terminateWorkflow: vi.fn() };
    const launcher = new RunLauncherService(store, durable as never);

    await expect(launcher.createRun(TENANT, WORKFLOW)).rejects.toBeInstanceOf(WorkflowNotFoundError);
    expect(durable.startWorkflow).not.toHaveBeenCalled();
  });

  it("rejects when there is no promoted version and none was given explicitly", async () => {
    const { store } = fakeStore({ workflowExists: true, promotedVersion: undefined });
    const durable = { startWorkflow: vi.fn(), terminateWorkflow: vi.fn() };
    const launcher = new RunLauncherService(store, durable as never);

    await expect(launcher.createRun(TENANT, WORKFLOW)).rejects.toBeInstanceOf(RunValidationError);
  });

  it("rejects an explicit workflow_version_id that cannot be run (e.g. retired)", async () => {
    const { store } = fakeStore({
      workflowExists: true,
      explicitVersion: { id: WORKFLOW_VERSION, status: "retired", compiled_dag: compiledDag() },
    });
    const durable = { startWorkflow: vi.fn(), terminateWorkflow: vi.fn() };
    const launcher = new RunLauncherService(store, durable as never);

    await expect(
      launcher.createRun(TENANT, WORKFLOW, WORKFLOW_VERSION),
    ).rejects.toBeInstanceOf(RunValidationError);
  });

  it("marks the run failed when the durable workflow fails to start", async () => {
    const { store, tx } = fakeStore({
      workflowExists: true,
      promotedVersion: { id: WORKFLOW_VERSION, compiled_dag: compiledDag() },
    });
    const durable = {
      startWorkflow: vi.fn().mockRejectedValue(new Error("temporal unreachable")),
      terminateWorkflow: vi.fn(),
    };
    const launcher = new RunLauncherService(store, durable as never);

    await expect(launcher.createRun(TENANT, WORKFLOW)).rejects.toBeInstanceOf(RunStartFailedError);
    const statements = tx.query.mock.calls.map((call) => String(call[0]));
    expect(statements.some((s: string) => s.includes("status = 'failed'"))).toBe(true);
  });
});

describe("RunLauncherService.createProjectRun", () => {
  it("provisions through the handler, durably persists that real session, and a fresh launcher retrieves it after restart", async () => {
    const { store, provision, lifecycle } = projectRunHarness();
    const durable = {
      startWorkflow: vi.fn().mockResolvedValue({ workflowId: RUN, runId: "temporal-project-run" }),
      terminateWorkflow: vi.fn(),
    };
    const launcher = new RunLauncherService(store, durable as never, undefined, lifecycle);

    const created = await launcher.createProjectRun(TENANT, {
      projectId: PROJECT,
      cycle_id: "cycle_1",
      template_id: "base",
      environment_refs: { API_KEY: "secret/project/api-key" },
      scaffold: [{ path: "package.json", content: "{}" }],
      compiledDag: compiledDag(),
    });

    expect(provision).toHaveBeenCalledWith({
      tenant_id: TENANT,
      run_id: created.id,
      project_id: PROJECT,
      cycle_id: "cycle_1",
      template_id: "base",
      environment_refs: { API_KEY: "secret/project/api-key" },
      scaffold: [{ path: "package.json", content: "{}" }],
    });
    expect(created).toMatchObject({
      parent_kind: "project",
      project_id: PROJECT,
      provisioning_session_id: SESSION,
      status: "running",
    });
    expect(durable.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: created.id, workflowType: "executorWorkflow" }),
    );

    // Simulates a fresh worker/process: only the durable runs row survives.
    const restartedLauncher = new RunLauncherService(
      store,
      durable as never,
      undefined,
      lifecycle,
    );
    await expect(restartedLauncher.getRun(TENANT, created.id)).resolves.toMatchObject({
      provisioning_session_id: SESSION,
      provisioning_cycle_id: "cycle_1",
    });
    await expect(
      lifecycle.provisionForRun(TENANT, created.id, PROJECT, {
        cycle_id: "cycle_1",
        template_id: "base",
        environment_refs: { API_KEY: "secret/project/api-key" },
        scaffold: [{ path: "package.json", content: "{}" }],
      }),
    ).resolves.toBe(SESSION);
    expect(provision).toHaveBeenCalledTimes(1);
  });

  it("closes the provisioned cycle when the project run is cancelled", async () => {
    const { store, closeCycle, lifecycle } = projectRunHarness();
    const durable = {
      startWorkflow: vi.fn().mockResolvedValue({ workflowId: RUN, runId: "temporal-project-run" }),
      terminateWorkflow: vi.fn().mockResolvedValue(undefined),
    };
    const launcher = new RunLauncherService(store, durable as never, undefined, lifecycle);
    const created = await launcher.createProjectRun(TENANT, {
      projectId: PROJECT,
      cycle_id: "cycle_1",
      template_id: "base",
      environment_refs: {},
      scaffold: [],
      compiledDag: compiledDag(),
    });

    await launcher.cancelRun(TENANT, created.id);

    expect(closeCycle).toHaveBeenCalledWith({
      tenant_id: TENANT,
      run_id: created.id,
      project_id: PROJECT,
      cycle_id: "cycle_1",
    });
  });

  it("closes the provisioned cycle when Temporal cannot start the project run", async () => {
    const { store, closeCycle, lifecycle } = projectRunHarness();
    const durable = {
      startWorkflow: vi.fn().mockRejectedValue(new Error("Temporal unavailable")),
      terminateWorkflow: vi.fn(),
    };
    const launcher = new RunLauncherService(store, durable as never, undefined, lifecycle);

    await expect(
      launcher.createProjectRun(TENANT, {
        projectId: PROJECT,
        cycle_id: "cycle_1",
        template_id: "base",
        environment_refs: {},
        scaffold: [],
        compiledDag: compiledDag(),
      }),
    ).rejects.toThrow("failed to start its durable workflow");

    expect(closeCycle).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: PROJECT, cycle_id: "cycle_1" }),
    );
  });

  it("persists the session returned by an idempotent Provision response", async () => {
    const { store, lifecycle } = projectRunHarness({ reused: true });
    const durable = {
      startWorkflow: vi.fn().mockResolvedValue({ workflowId: RUN, runId: "temporal-project-run" }),
      terminateWorkflow: vi.fn(),
    };
    const launcher = new RunLauncherService(store, durable as never, undefined, lifecycle);

    const created = await launcher.createProjectRun(TENANT, {
      projectId: PROJECT,
      cycle_id: "cycle_retry",
      template_id: "base",
      environment_refs: {},
      scaffold: [],
      compiledDag: compiledDag(),
    });

    expect(created.provisioning_session_id).toBe(SESSION);
  });
});

describe("RunLauncherService.cancelRun", () => {
  it("terminates the workflow and marks the run cancelled", async () => {
    const { store } = fakeStore({
      runRow: {
        id: RUN, workflow_id: WORKFLOW, workflow_version_id: WORKFLOW_VERSION,
        parent_kind: "workflow", status: "running", started_at: "2026-07-28T00:00:00.000Z",
        ended_at: null, created_at: "2026-07-28T00:00:00.000Z",
      },
    });
    const durable = { startWorkflow: vi.fn(), terminateWorkflow: vi.fn().mockResolvedValue(undefined) };
    const launcher = new RunLauncherService(store, durable as never);

    await launcher.cancelRun(TENANT, RUN);

    expect(durable.terminateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: RUN }),
    );
  });

  it("is a no-op that reports the real state when the run already finished", async () => {
    const runRow = {
      id: RUN, workflow_id: WORKFLOW, workflow_version_id: WORKFLOW_VERSION,
      parent_kind: "workflow", status: "completed", started_at: "2026-07-28T00:00:00.000Z",
      ended_at: "2026-07-28T00:00:02.000Z", created_at: "2026-07-28T00:00:00.000Z",
    };
    const { store, tx } = fakeStore({ runRow });
    tx.query.mockImplementation(async (statement: string) => {
      if (statement.includes("UPDATE runs SET status = 'cancelled'")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [runRow] };
    });
    const durable = { startWorkflow: vi.fn(), terminateWorkflow: vi.fn() };
    const launcher = new RunLauncherService(store, durable as never);

    const result = await launcher.cancelRun(TENANT, RUN);
    expect(result.status).toBe("completed");
    // Already terminal -- terminateWorkflow must not be called at all.
    expect(durable.terminateWorkflow).not.toHaveBeenCalled();
  });

  it("raises RunNotFoundError for a run the tenant cannot see", async () => {
    const { store, tx } = fakeStore({});
    tx.query.mockImplementation(async () => ({ rowCount: 0, rows: [] }));
    const durable = { startWorkflow: vi.fn(), terminateWorkflow: vi.fn() };
    const launcher = new RunLauncherService(store, durable as never);

    await expect(launcher.cancelRun(TENANT, RUN)).rejects.toBeInstanceOf(RunNotFoundError);
  });
});

describe("RunLauncherService.retryNode", () => {
  it("rejects retry-node unless the run status is failed", async () => {
    const runRow = {
      id: RUN, workflow_id: WORKFLOW, workflow_version_id: WORKFLOW_VERSION,
      parent_kind: "workflow", status: "running", started_at: "2026-07-28T00:00:00.000Z",
      ended_at: null, created_at: "2026-07-28T00:00:00.000Z",
    };
    const { store } = fakeStore({ runRow });
    const durable = { startWorkflow: vi.fn(), terminateWorkflow: vi.fn() };
    const launcher = new RunLauncherService(store, durable as never);

    await expect(launcher.retryNode(TENANT, RUN, "node_a")).rejects.toBeInstanceOf(
      RunStateConflictError,
    );
  });

  it("starts a narrowed single-node workflow and flips status to running", async () => {
    const runRow = {
      id: RUN, workflow_id: WORKFLOW, workflow_version_id: WORKFLOW_VERSION,
      parent_kind: "workflow", status: "failed", started_at: "2026-07-28T00:00:00.000Z",
      ended_at: "2026-07-28T00:00:05.000Z", created_at: "2026-07-28T00:00:00.000Z",
    };
    const { store, tx } = fakeStore({ runRow });
    tx.query.mockImplementation(async (statement: string) => {
      if (statement.includes("SELECT id, status FROM runs") || statement.startsWith("SELECT id, workflow_id")) {
        return { rowCount: 1, rows: [runRow] };
      }
      if (statement.includes("SELECT id, workflow_id, workflow_version_id, parent_kind, status")) {
        return { rowCount: 1, rows: [runRow] };
      }
      if (statement.includes("SELECT compiled_dag FROM workflow_versions")) {
        return { rowCount: 1, rows: [{ compiled_dag: compiledDag() }] };
      }
      if (statement.includes("UPDATE runs")) {
        return { rowCount: 1, rows: [{ ...runRow, status: "running", ended_at: null }] };
      }
      return { rowCount: 1, rows: [runRow] };
    });
    const durable = {
      startWorkflow: vi.fn().mockResolvedValue({ workflowId: RUN, runId: "temporal-run-2" }),
      terminateWorkflow: vi.fn(),
    };
    const launcher = new RunLauncherService(store, durable as never);

    const result = await launcher.retryNode(TENANT, RUN, "node_a");

    expect(durable.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: RUN, workflowType: "executorWorkflow" }),
    );
    const startedInput = durable.startWorkflow.mock.calls[0]![0].input;
    const narrowedDag = JSON.parse(startedInput.compiledDagJson);
    expect(narrowedDag.nodes).toHaveLength(1);
    expect(narrowedDag.nodes[0].key).toBe("node_a");
    expect(result.status).toBe("running");
  });

  it("rejects an unknown node_key", async () => {
    const runRow = {
      id: RUN, workflow_id: WORKFLOW, workflow_version_id: WORKFLOW_VERSION,
      parent_kind: "workflow", status: "failed", started_at: "2026-07-28T00:00:00.000Z",
      ended_at: "2026-07-28T00:00:05.000Z", created_at: "2026-07-28T00:00:00.000Z",
    };
    const { store, tx } = fakeStore({ runRow });
    tx.query.mockImplementation(async (statement: string) => {
      if (statement.includes("SELECT compiled_dag FROM workflow_versions")) {
        return { rowCount: 1, rows: [{ compiled_dag: compiledDag() }] };
      }
      return { rowCount: 1, rows: [runRow] };
    });
    const durable = { startWorkflow: vi.fn(), terminateWorkflow: vi.fn() };
    const launcher = new RunLauncherService(store, durable as never);

    await expect(launcher.retryNode(TENANT, RUN, "node_nonexistent")).rejects.toBeInstanceOf(
      RunValidationError,
    );
    expect(durable.startWorkflow).not.toHaveBeenCalled();
  });
});
