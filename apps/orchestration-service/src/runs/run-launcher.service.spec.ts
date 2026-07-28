import { describe, expect, it, vi } from "vitest";

import {
  RunLauncherService,
  RunNotFoundError,
  RunStartFailedError,
  RunStateConflictError,
  RunValidationError,
  WorkflowNotFoundError,
  type OrchestrationTenantStore,
} from "./run-launcher.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const WORKFLOW = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const WORKFLOW_VERSION = "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function compiledDag() {
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
