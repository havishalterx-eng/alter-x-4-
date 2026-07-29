import { randomBytes } from "node:crypto";

import type {
  RecoveryClassifyFailureRequest,
  RecoveryClassifyFailureResponse,
  RecoverySelectStrategyRequest,
  RecoverySelectStrategyResponse,
} from "@alterx/contracts";

export interface RecoveryClassifyHandler {
  classifyFailure(
    request: RecoveryClassifyFailureRequest,
  ): Promise<RecoveryClassifyFailureResponse>;
}

export interface RecoverySelectHandler {
  selectStrategy(
    request: RecoverySelectStrategyRequest,
  ): Promise<RecoverySelectStrategyResponse>;
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Mirrors recovery-action-id.ts's minting shape for a different prefix. */
function mintPrefixedUuidV7(prefix: string, now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return `${prefix}_${bytesToUuid(bytes)}`;
}

/**
 * Closes the real gap between HEAL-4 (writes node_executions.status =
 * 'blocked_pending_recovery') and HEAL-5/6 (only respond if invoked --
 * nothing called them automatically before this). Best-effort by design:
 * the blocked_pending_recovery ledger write already succeeded durably
 * before this runs, so a trigger failure here must not crash the node's
 * response to the Executor. Known gap: there is no background reconciler
 * yet that re-scans blocked nodes lacking a recovery_actions row if this
 * one-shot trigger fails -- that would be a real, disclosed follow-up.
 */
export class RecoveryTriggerService {
  constructor(
    private readonly classifier: RecoveryClassifyHandler,
    private readonly selector: RecoverySelectHandler,
  ) {}

  async triggerForBlockedNode(params: {
    readonly tenantId: string; // ten_ prefixed
    readonly runId: string;
    readonly nodeExecutionId: string;
    readonly reason: string;
  }): Promise<void> {
    const errorJson = JSON.stringify({
      trace_id: mintPrefixedUuidV7("trc"),
      request_id: mintPrefixedUuidV7("req"),
      error_code: "VERIFICATION_BLOCKED_PENDING_RECOVERY",
      detail: params.reason,
    });
    const classified = await this.classifier.classifyFailure({
      tenant_id: params.tenantId,
      run_id: params.runId,
      node_execution_id: params.nodeExecutionId,
      error_json: errorJson,
    });
    await this.selector.selectStrategy({
      tenant_id: params.tenantId,
      run_id: params.runId,
      node_execution_id: params.nodeExecutionId,
      failure_class: classified.failure_class,
      root_cause_estimate_json: classified.root_cause_estimate_json,
    });
  }
}
