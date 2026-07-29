import { describe, expect, it, vi } from "vitest";

import {
  ApprovalNotFoundError,
  ApprovalsService,
  ApprovalStateConflictError,
  ApprovalValidationError,
  type ApprovalDecisionSignaler,
  type ApprovalRow,
  type OrchestrationTenantStore,
} from "./approvals.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const NODE_EXECUTION = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const APPROVAL = "apr_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

interface FakeTx {
  query: ReturnType<typeof vi.fn>;
}

function baseRow(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: APPROVAL,
    run_id: RUN,
    node_execution_id: NODE_EXECUTION,
    requested_action: { message: "send invoice" },
    status: "pending",
    requested_at: "2026-07-28T00:00:00.000Z",
    decided_at: null,
    decided_by: null,
    decision_note: null,
    expiry_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeStore(row: ApprovalRow): { store: OrchestrationTenantStore; tx: FakeTx } {
  let current = row;
  const query = vi.fn(async (statement: string, values?: readonly unknown[]) => {
    if (statement.includes("INSERT INTO approvals")) {
      return { rowCount: 1, rows: [{ expiry_at: current.expiry_at }] };
    }
    if (statement.includes("UPDATE approvals") && statement.includes("status = 'expired'")) {
      if (current.status === "pending" && current.expiry_at < "2026-07-28T00:00:00.001Z") {
        current = { ...current, status: "expired" };
        return { rowCount: 1, rows: [current] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (statement.includes("UPDATE approvals")) {
      const decision = values?.[2] as string;
      if (current.status !== "pending") return { rowCount: 0, rows: [] };
      current = {
        ...current,
        status: decision,
        decided_at: "2026-07-28T01:00:00.000Z",
        decided_by: (values?.[3] as string | null) ?? null,
        decision_note: (values?.[4] as string | null) ?? null,
      };
      return { rowCount: 1, rows: [current] };
    }
    if (statement.includes("SELECT") && statement.includes("FROM approvals")) {
      return { rowCount: 1, rows: [current] };
    }
    return { rowCount: 0, rows: [] };
  });
  const tx: FakeTx = { query };
  const store: OrchestrationTenantStore = {
    withTenant: async (tenantId, operation) => {
      expect(tenantId).toBe(BARE_TENANT);
      return operation(tx as never);
    },
  };
  return { store, tx };
}

function fakeSignaler(): ApprovalDecisionSignaler & { signalWorkflow: ReturnType<typeof vi.fn> } {
  return { signalWorkflow: vi.fn().mockResolvedValue(undefined) };
}

describe("ApprovalsService.createPending", () => {
  it("inserts a pending row and returns its id and expiry", async () => {
    const { store } = fakeStore(baseRow());
    const service = new ApprovalsService(store, fakeSignaler());

    const result = await service.createPending({
      tenantId: TENANT,
      runId: RUN,
      nodeExecutionId: NODE_EXECUTION,
      requestedAction: { message: "send invoice" },
      expirySeconds: 86_400,
    });

    expect(result.id).toMatch(/^apr_[0-9a-f-]+$/i);
    expect(result.expiryAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("rejects a non-positive expirySeconds", async () => {
    const { store } = fakeStore(baseRow());
    const service = new ApprovalsService(store, fakeSignaler());

    await expect(
      service.createPending({
        tenantId: TENANT,
        runId: RUN,
        nodeExecutionId: NODE_EXECUTION,
        requestedAction: {},
        expirySeconds: 0,
      }),
    ).rejects.toBeInstanceOf(ApprovalValidationError);
  });
});

describe("ApprovalsService.getById", () => {
  it("returns the row", async () => {
    const { store } = fakeStore(baseRow());
    const service = new ApprovalsService(store, fakeSignaler());

    await expect(service.getById(TENANT, APPROVAL)).resolves.toMatchObject({ id: APPROVAL });
  });

  it("auto-expires a past-due pending row on read", async () => {
    const { store } = fakeStore(baseRow({ expiry_at: "2020-01-01T00:00:00.000Z" }));
    const service = new ApprovalsService(store, fakeSignaler());

    await expect(service.getById(TENANT, APPROVAL)).resolves.toMatchObject({ status: "expired" });
  });

  it("rejects a malformed approval id", async () => {
    const { store } = fakeStore(baseRow());
    const service = new ApprovalsService(store, fakeSignaler());

    await expect(service.getById(TENANT, "not-an-id")).rejects.toBeInstanceOf(
      ApprovalValidationError,
    );
  });
});

describe("ApprovalsService.decide", () => {
  it("signals the run's workflow before committing an approval", async () => {
    const { store } = fakeStore(baseRow());
    const signaler = fakeSignaler();
    const service = new ApprovalsService(store, signaler);

    const result = await service.decide(TENANT, APPROVAL, "approved", undefined, "looks good");

    expect(signaler.signalWorkflow).toHaveBeenCalledWith({
      workflowId: RUN,
      signalName: "approvalDecided",
      payload: { nodeExecutionId: NODE_EXECUTION, approved: true, note: "looks good" },
    });
    expect(result).toMatchObject({ status: "approved", decision_note: "looks good" });
  });

  it("signals rejection with approved:false", async () => {
    const { store } = fakeStore(baseRow());
    const signaler = fakeSignaler();
    const service = new ApprovalsService(store, signaler);

    await service.decide(TENANT, APPROVAL, "rejected", undefined, undefined);

    expect(signaler.signalWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ approved: false }) }),
    );
  });

  it("raises ApprovalNotFoundError for an unknown approval", async () => {
    const { store, tx } = fakeStore(baseRow());
    tx.query.mockImplementation(async () => ({ rowCount: 0, rows: [] }));
    const service = new ApprovalsService(store, fakeSignaler());

    await expect(
      service.decide(TENANT, APPROVAL, "approved", undefined, undefined),
    ).rejects.toBeInstanceOf(ApprovalNotFoundError);
  });

  it("raises ApprovalStateConflictError when already decided", async () => {
    const { store } = fakeStore(baseRow({ status: "approved" }));
    const service = new ApprovalsService(store, fakeSignaler());

    await expect(
      service.decide(TENANT, APPROVAL, "approved", undefined, undefined),
    ).rejects.toBeInstanceOf(ApprovalStateConflictError);
  });

  it("does not signal the workflow when the approval is already decided", async () => {
    const { store } = fakeStore(baseRow({ status: "rejected" }));
    const signaler = fakeSignaler();
    const service = new ApprovalsService(store, signaler);

    await expect(
      service.decide(TENANT, APPROVAL, "approved", undefined, undefined),
    ).rejects.toBeInstanceOf(ApprovalStateConflictError);
    expect(signaler.signalWorkflow).not.toHaveBeenCalled();
  });
});
