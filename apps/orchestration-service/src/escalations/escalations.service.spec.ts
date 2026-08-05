import { describe, expect, it, vi } from "vitest";

import {
  EscalationNotFoundError,
  EscalationsService,
  EscalationStateConflictError,
  EscalationValidationError,
  type EscalationRow,
  type OrchestrationTenantStore,
} from "./escalations.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const NODE_EXECUTION = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RECOVERY_ACTION = "rec_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const ESCALATION = "esc_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

interface FakeTx {
  query: ReturnType<typeof vi.fn>;
}

function baseRow(overrides: Partial<EscalationRow> = {}): EscalationRow {
  return {
    id: ESCALATION,
    run_id: RUN,
    node_execution_id: NODE_EXECUTION,
    recovery_action_id: RECOVERY_ACTION,
    reason: "recovery exhausted",
    status: "open",
    claimed_by: null,
    claimed_at: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    created_at: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

function fakeStore(row: EscalationRow): { store: OrchestrationTenantStore; tx: FakeTx } {
  let current = row;
  const query = vi.fn(async (statement: string, values?: readonly unknown[]) => {
    if (statement.includes("INSERT INTO escalations")) {
      return { rowCount: 1, rows: [current] };
    }
    if (statement.includes("UPDATE escalations") && statement.includes("status = 'claimed'")) {
      if (current.status !== "open") return { rowCount: 0, rows: [] };
      current = {
        ...current,
        status: "claimed",
        claimed_by: (values?.[2] as string | null) ?? null,
        claimed_at: "2026-08-06T01:00:00.000Z",
      };
      return { rowCount: 1, rows: [current] };
    }
    if (statement.includes("UPDATE escalations") && statement.includes("status = 'resolved'")) {
      if (current.status === "resolved") return { rowCount: 0, rows: [] };
      current = {
        ...current,
        status: "resolved",
        resolved_by: (values?.[2] as string | null) ?? null,
        resolved_at: "2026-08-06T02:00:00.000Z",
        resolution_note: (values?.[3] as string | null) ?? null,
      };
      return { rowCount: 1, rows: [current] };
    }
    if (statement.includes("SELECT") && statement.includes("FROM escalations")) {
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

describe("EscalationsService.create", () => {
  it("inserts a real open escalation row", async () => {
    const { store } = fakeStore(baseRow());
    const service = new EscalationsService(store);

    const result = await service.create({
      tenantId: TENANT,
      runId: RUN,
      nodeExecutionId: NODE_EXECUTION,
      recoveryActionId: RECOVERY_ACTION,
      reason: "recovery exhausted",
    });

    expect(result).toMatchObject({ status: "open" });
  });
});

describe("EscalationsService.getById", () => {
  it("returns the row", async () => {
    const { store } = fakeStore(baseRow());
    const service = new EscalationsService(store);

    await expect(service.getById(TENANT, ESCALATION)).resolves.toMatchObject({ id: ESCALATION });
  });

  it("rejects a malformed escalation id", async () => {
    const { store } = fakeStore(baseRow());
    const service = new EscalationsService(store);

    await expect(service.getById(TENANT, "not-an-id")).rejects.toBeInstanceOf(
      EscalationValidationError,
    );
  });

  it("raises EscalationNotFoundError for an unknown escalation", async () => {
    const { store, tx } = fakeStore(baseRow());
    tx.query.mockImplementation(async () => ({ rowCount: 0, rows: [] }));
    const service = new EscalationsService(store);

    await expect(service.getById(TENANT, ESCALATION)).rejects.toBeInstanceOf(
      EscalationNotFoundError,
    );
  });
});

describe("EscalationsService.claim", () => {
  it("claims an open escalation", async () => {
    const { store } = fakeStore(baseRow());
    const service = new EscalationsService(store);

    const result = await service.claim(TENANT, ESCALATION, "018f4d6e-user");

    expect(result).toMatchObject({ status: "claimed", claimed_by: "018f4d6e-user" });
  });

  it("raises EscalationStateConflictError when already claimed", async () => {
    const { store } = fakeStore(baseRow({ status: "claimed" }));
    const service = new EscalationsService(store);

    await expect(service.claim(TENANT, ESCALATION, undefined)).rejects.toBeInstanceOf(
      EscalationStateConflictError,
    );
  });

  it("raises EscalationNotFoundError for an unknown escalation", async () => {
    const { store, tx } = fakeStore(baseRow());
    tx.query.mockImplementation(async () => ({ rowCount: 0, rows: [] }));
    const service = new EscalationsService(store);

    await expect(service.claim(TENANT, ESCALATION, undefined)).rejects.toBeInstanceOf(
      EscalationNotFoundError,
    );
  });
});

describe("EscalationsService.resolve", () => {
  it("resolves an open escalation directly", async () => {
    const { store } = fakeStore(baseRow());
    const service = new EscalationsService(store);

    const result = await service.resolve(TENANT, ESCALATION, "018f4d6e-user", "handled manually");

    expect(result).toMatchObject({
      status: "resolved",
      resolved_by: "018f4d6e-user",
      resolution_note: "handled manually",
    });
  });

  it("resolves a claimed escalation", async () => {
    const { store } = fakeStore(baseRow({ status: "claimed" }));
    const service = new EscalationsService(store);

    await expect(
      service.resolve(TENANT, ESCALATION, undefined, undefined),
    ).resolves.toMatchObject({ status: "resolved" });
  });

  it("raises EscalationStateConflictError when already resolved", async () => {
    const { store } = fakeStore(baseRow({ status: "resolved" }));
    const service = new EscalationsService(store);

    await expect(
      service.resolve(TENANT, ESCALATION, undefined, undefined),
    ).rejects.toBeInstanceOf(EscalationStateConflictError);
  });
});
