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
 * Closes the real gap between node execution failures (Gate-blocked via
 * HEAL-4, or a genuine exception/ProblemDetails failure) and HEAL-5/6 (only
 * respond if invoked -- nothing called them automatically before this).
 * Best-effort by design: the durable ledger write (blocked or failed)
 * already succeeded before either trigger method runs, so a trigger
 * failure here must not crash the node's response to the Executor. Known
 * gap: there is no background reconciler yet that re-scans nodes lacking a
 * recovery_actions row if this one-shot trigger fails -- that would be a
 * real, disclosed follow-up.
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
    return this.#trigger(params, "VERIFICATION_BLOCKED_PENDING_RECOVERY", params.reason);
  }

  /**
   * Self-Healing exit-check closure: genuine node exceptions/ProblemDetails
   * failures previously never reached HEAL-5/6 at all -- only Gate-blocked
   * nodes did (see class docstring). Without this, strategies whose policy
   * table entries target real failure classes (retry/backoff on
   * timeout/infrastructure_failure/rate_limit) could never actually fire in
   * a live run. Real error_code/detail passed through instead of the
   * Gate-block's hardcoded synthetic one, so the classifier sees the real
   * failure, not a fabricated "verification blocked" reason.
   */
  async triggerForFailedNode(params: {
    readonly tenantId: string; // ten_ prefixed
    readonly runId: string;
    readonly nodeExecutionId: string;
    readonly errorCode: string;
    readonly detail: string;
  }): Promise<void> {
    return this.#trigger(params, params.errorCode, params.detail);
  }

  async #trigger(
    params: { readonly tenantId: string; readonly runId: string; readonly nodeExecutionId: string },
    errorCode: string,
    detail: string,
  ): Promise<void> {
    const errorJson = JSON.stringify({
      trace_id: mintPrefixedUuidV7("trc"),
      request_id: mintPrefixedUuidV7("req"),
      error_code: errorCode,
      detail,
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
