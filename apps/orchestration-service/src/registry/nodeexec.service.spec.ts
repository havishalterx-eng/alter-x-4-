import { describe, expect, it, vi } from "vitest";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeHandler,
} from "./handler";
import { MergeHandler } from "./handlers/merge.handler";
import { NodeHandlerRegistry } from "./node-handler-registry";
import { NodeexecService } from "./nodeexec.service";
import { NodeExecutionLedgerService } from "../runs/node-execution-ledger.service";
import { RunStreamEventService } from "../runs/run-stream-event.service";
import type { RecoveryTriggerService } from "../recovery/recovery-trigger.service";

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function service(ledger = fakeLedger()): NodeexecService {
  return new NodeexecService(new NodeHandlerRegistry([new MergeHandler()]), ledger);
}

function fakeLedger(): NodeExecutionLedgerService {
  return {
    recordStarted: vi.fn().mockResolvedValue({
      attempt: 1,
      startedAt: "2026-07-28T00:00:00.000Z",
    }),
    recordSucceeded: vi.fn().mockResolvedValue(undefined),
    recordFailed: vi.fn().mockResolvedValue(undefined),
    finalizeRun: vi.fn().mockResolvedValue({
      status: "completed",
      endedAt: "2026-07-28T00:00:01.000Z",
    }),
  } as unknown as NodeExecutionLedgerService;
}

describe("NodeexecService.executeNode", () => {
  it("dispatches to the handler and returns JSON-serialized output/metadata", async () => {
    const ledger = fakeLedger();
    const response = await service(ledger).executeNode({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      node_key: "node_merge",
      node_type: "Merge",
      config_json: "{}",
      inputs_json: JSON.stringify({ node_a: { x: 1 } }),
    });

    expect(JSON.parse(response.output_json)).toEqual({ x: 1 });
    expect(JSON.parse(response.metadata_json)).toEqual({});
    expect(ledger.recordStarted).toHaveBeenCalledOnce();
    expect(ledger.recordSucceeded).toHaveBeenCalledOnce();
  });

  it("passes sandbox_session_id from compiled config through execution context", async () => {
    let received: NodeExecutionContext | undefined;
    const handler: NodeHandler = {
      nodeType: "SandboxExec",
      async execute(context) {
        received = context;
        return { output: {} };
      },
    };
    const nodeexec = new NodeexecService(
      new NodeHandlerRegistry([handler]),
      fakeLedger(),
    );

    await nodeexec.executeNode({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      node_key: "node_sandbox",
      node_type: "SandboxExec",
      config_json: JSON.stringify({ sandbox_session_id: "e2b_ses_123" }),
      inputs_json: "{}",
    });

    expect(received?.sandbox_session_id).toBe("e2b_ses_123");
  });

  it("rejects a blank node_key", async () => {
    await expect(
      service().executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "",
        node_type: "Merge",
        config_json: "{}",
        inputs_json: "{}",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects an unknown node type before opening a durable execution", async () => {
    const ledger = fakeLedger();

    await expect(
      service(ledger).executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "node_unknown",
        node_type: "UnknownNode",
        config_json: "{}",
        inputs_json: "{}",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
    expect(ledger.recordStarted).not.toHaveBeenCalled();
  });

  it("rejects malformed config_json", async () => {
    await expect(
      service().executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "node_merge",
        node_type: "Merge",
        config_json: "{not json",
        inputs_json: "{}",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("fails closed when recording a failed execution cannot persist", async () => {
    const persistenceFailure = new Error("checkpoint store unavailable");
    const ledger = fakeLedger();
    vi.mocked(ledger.recordFailed).mockRejectedValue(persistenceFailure);

    await expect(
      service(ledger).executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "node_merge",
        node_type: "Merge",
        config_json: "{not json",
        inputs_json: "{}",
      }),
    ).rejects.toThrow(persistenceFailure);
  });

  it("triggers recovery for a genuine node exception, not only for Gate-blocked nodes", async () => {
    const ledger = fakeLedger();
    const recovery = {
      triggerForBlockedNode: vi.fn().mockResolvedValue(undefined),
      triggerForFailedNode: vi.fn().mockResolvedValue(undefined),
    } as unknown as RecoveryTriggerService;
    const nodeexec = new NodeexecService(
      new NodeHandlerRegistry([new MergeHandler()]),
      ledger,
      undefined,
      recovery,
    );

    await expect(
      nodeexec.executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "node_merge",
        node_type: "Merge",
        config_json: "{not json",
        inputs_json: "{}",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);

    expect(recovery.triggerForFailedNode).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      nodeExecutionId: NODE_EXECUTION_ID,
      errorCode: "NODE_HANDLER_VALIDATION_FAILED",
      detail: expect.stringContaining("config_json is not valid JSON"),
    });
    expect(recovery.triggerForBlockedNode).not.toHaveBeenCalled();
  });

  it("does not let a recovery-trigger failure mask the real node failure (best-effort)", async () => {
    const ledger = fakeLedger();
    const recovery = {
      triggerForBlockedNode: vi.fn().mockResolvedValue(undefined),
      triggerForFailedNode: vi.fn().mockRejectedValue(new Error("trigger unreachable")),
    } as unknown as RecoveryTriggerService;
    const nodeexec = new NodeexecService(
      new NodeHandlerRegistry([new MergeHandler()]),
      ledger,
      undefined,
      recovery,
    );

    await expect(
      nodeexec.executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "node_merge",
        node_type: "Merge",
        config_json: "{not json",
        inputs_json: "{}",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects malformed inputs_json", async () => {
    await expect(
      service().executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "node_merge",
        node_type: "Merge",
        config_json: "{}",
        inputs_json: "[1,2,3]",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("records the predecessor keys read as input_ref and the node's own key as output_ref on success", async () => {
    const ledger = fakeLedger();
    await service(ledger).executeNode({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      node_key: "node_merge",
      node_type: "Merge",
      config_json: "{}",
      inputs_json: JSON.stringify({ node_a: { x: 1 }, node_b: { y: 2 } }),
    });

    expect(ledger.recordStarted).toHaveBeenCalledWith(
      expect.objectContaining({ inputRef: "node_a,node_b" }),
    );
    expect(ledger.recordSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ outputRef: "node_merge" }),
    );
  });

  it("omits input_ref for a source node with no predecessor data", async () => {
    const ledger = fakeLedger();
    await service(ledger).executeNode({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      node_key: "node_merge",
      node_type: "Merge",
      config_json: "{}",
      inputs_json: "{}",
    });

    expect(ledger.recordStarted).toHaveBeenCalledWith(
      expect.not.objectContaining({ inputRef: expect.anything() }),
    );
  });
});

describe("NodeexecService.finalizeRun", () => {
  it("finalizes a completed run and emits a run.status SSE event", async () => {
    const ledger = fakeLedger();
    const streamEvents = { append: vi.fn().mockResolvedValue(undefined) };
    const nodeexec = new NodeexecService(
      new NodeHandlerRegistry([new MergeHandler()]),
      ledger,
      streamEvents as unknown as RunStreamEventService,
    );

    const response = await nodeexec.finalizeRun({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      status: "completed",
      error_json: "",
    });

    expect(response.status).toBe("completed");
    expect(ledger.finalizeRun).toHaveBeenCalledWith(TENANT_ID, RUN_ID, "completed");
    expect(streamEvents.append).toHaveBeenCalledWith(
      TENANT_ID,
      RUN_ID,
      expect.objectContaining({ event: "run.status", data: { status: "completed" } }),
    );
  });

  it("does not emit run.status when the run was already terminal for another reason", async () => {
    const ledger = fakeLedger();
    vi.mocked(ledger.finalizeRun).mockResolvedValue({
      status: "cancelled",
      endedAt: "2026-07-28T00:00:01.000Z",
    });
    const streamEvents = { append: vi.fn().mockResolvedValue(undefined) };
    const nodeexec = new NodeexecService(
      new NodeHandlerRegistry([new MergeHandler()]),
      ledger,
      streamEvents as unknown as RunStreamEventService,
    );

    const response = await nodeexec.finalizeRun({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      status: "failed",
      error_json: "{}",
    });

    expect(response.status).toBe("cancelled");
    expect(streamEvents.append).not.toHaveBeenCalled();
  });

  it("rejects a status other than completed or failed", async () => {
    await expect(
      service().finalizeRun({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        status: "running",
        error_json: "",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });
});
