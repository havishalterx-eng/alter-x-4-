import type { NodeType } from "@alterx/contracts";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";

const DEFAULT_EXPIRY_SECONDS = 86_400; // 24h

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ApprovalRequester {
  requestApproval(request: {
    readonly tenantId: string;
    readonly runId: string;
    readonly nodeExecutionId: string;
    readonly requestedAction: Record<string, unknown>;
    readonly expirySeconds: number;
  }): Promise<{ readonly approvalId: string; readonly expiryAt: string }>;
}

/**
 * Persists a pending approval request (HEAL-7) and returns immediately --
 * this handler never blocks. The Executor workflow durably pauses on the
 * returned approval_id via a Temporal signal+condition wait (survives a
 * worker restart); NodeexecService leaves this node_execution's ledger row
 * in 'running' rather than calling it succeeded, since the real outcome
 * isn't known yet. `config.requested_action` describes what the engine
 * wants to do (surfaced to the approver); `config.expiry_seconds` is
 * optional, defaulting to 24h.
 */
export class HumanApprovalHandler implements NodeHandler {
  readonly nodeType: NodeType = "HumanApproval";

  constructor(private readonly approvals: ApprovalRequester) {}

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    if (
      context.tenant_id === undefined ||
      context.run_id === undefined ||
      context.node_execution_id === undefined
    ) {
      throw new NodeHandlerValidationError(
        "HumanApproval requires tenant_id, run_id, and node_execution_id context",
      );
    }

    const requestedAction = isPlainObject(context.config["requested_action"])
      ? context.config["requested_action"]
      : context.config;

    const expirySecondsRaw = context.config["expiry_seconds"];
    const expirySeconds =
      typeof expirySecondsRaw === "number" && expirySecondsRaw > 0
        ? expirySecondsRaw
        : DEFAULT_EXPIRY_SECONDS;

    const { approvalId, expiryAt } = await this.approvals.requestApproval({
      tenantId: context.tenant_id,
      runId: context.run_id,
      nodeExecutionId: context.node_execution_id,
      requestedAction,
      expirySeconds,
    });

    return {
      output: {
        approval_id: approvalId,
        status: "pending",
        expiry_at: expiryAt,
      },
      metadata: { execution_status: "pending_approval" },
    };
  }
}
