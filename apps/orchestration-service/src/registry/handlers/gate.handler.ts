import type { NodeType } from "@alterx/contracts";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";
import type { VerificationGateReader, VerificationResultRecord } from "../verification-gate-reader";
import { CelSubsetError, evaluateCelSubset } from "./cel-subset";

/**
 * Gate: evaluates each successor's condition (config.conditions, set by
 * the Graph Compiler's Gate synthesis in dag-builder.ts) against upstream
 * inputs, and reports which successors are active.
 *
 * Uses the CEL subset in cel-subset.ts, not a full CEL implementation --
 * see that module's doc comment for the exact supported grammar.
 */
export class GateHandler implements NodeHandler {
  readonly nodeType: NodeType = "Gate";

  constructor(private readonly verificationReader?: VerificationGateReader) {}

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const verification = parseVerificationConfig(context.config["verification"]);
    if (verification !== undefined) return this.executeVerificationGate(context, verification);
    const conditions = context.config["conditions"];
    if (
      conditions === undefined ||
      conditions === null ||
      typeof conditions !== "object" ||
      Array.isArray(conditions)
    ) {
      throw new NodeHandlerValidationError(
        "Gate requires a config.conditions object (successor key -> CEL-subset expression)",
      );
    }

    const evaluations: Record<string, boolean> = {};
    const root = { inputs: context.inputs };
    for (const [successorKey, expression] of Object.entries(
      conditions as Record<string, unknown>,
    )) {
      if (typeof expression !== "string" || expression.trim().length === 0) {
        throw new NodeHandlerValidationError(
          `Gate condition for successor "${successorKey}" must be a non-empty string`,
        );
      }
      try {
        evaluations[successorKey] = evaluateCelSubset(expression, root);
      } catch (error: unknown) {
        if (error instanceof CelSubsetError) {
          throw new NodeHandlerValidationError(
            `Gate condition for successor "${successorKey}" is invalid: ${error.message}`,
          );
        }
        throw error;
      }
    }

    const activeSuccessors = Object.entries(evaluations)
      .filter(([, active]) => active)
      .map(([successorKey]) => successorKey);

    return { output: { activeSuccessors, evaluations } };
  }

  private async executeVerificationGate(context: NodeExecutionContext, verification: VerificationGateConfig): Promise<NodeExecutionResult> {
    if (this.verificationReader === undefined || context.tenant_id === undefined || context.run_id === undefined) {
      return blocked(verification.protectedNodeKey, "verification_context_unavailable");
    }
    let results: readonly VerificationResultRecord[];
    try {
      results = await this.verificationReader.findForSourceNode({ tenantId: context.tenant_id, runId: context.run_id, sourceNodeKey: verification.sourceNodeKey });
    } catch {
      return blocked(verification.protectedNodeKey, "verification_lookup_failed");
    }
    const decision = evaluateVerification(results);
    return decision.allowed
      ? { output: { activeSuccessors: [verification.protectedNodeKey], verification_status: "passed", verification_source_node_key: verification.sourceNodeKey } }
      : blocked(verification.protectedNodeKey, decision.reason);
  }
}

interface VerificationGateConfig { readonly sourceNodeKey: string; readonly protectedNodeKey: string; }

function parseVerificationConfig(value: unknown): VerificationGateConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new NodeHandlerValidationError("verification must be an object");
  const sourceNodeKey = (value as Record<string, unknown>)["source_node_key"];
  const protectedNodeKey = (value as Record<string, unknown>)["protected_node_key"];
  if (typeof sourceNodeKey !== "string" || sourceNodeKey.trim().length === 0) throw new NodeHandlerValidationError("verification.source_node_key is required");
  if (typeof protectedNodeKey !== "string" || protectedNodeKey.trim().length === 0) throw new NodeHandlerValidationError("verification.protected_node_key is required");
  return { sourceNodeKey, protectedNodeKey };
}

function evaluateVerification(results: readonly VerificationResultRecord[]): { readonly allowed: boolean; readonly reason: string } {
  const quality = results.find((result) => result.gateType === "quality");
  const safety = results.find((result) => result.gateType === "safety");
  if (quality === undefined || safety === undefined) return { allowed: false, reason: "verification_result_missing" };
  const score = numeric(quality.score);
  const threshold = numeric(quality.threshold);
  if (quality.verdict !== "pass" || score === undefined || threshold === undefined || score < threshold || threshold < 0 || threshold > 1 || score < 0 || score > 1) return { allowed: false, reason: "quality_verification_failed" };
  const severity = safetySeverity(safety.details);
  if (severity === undefined) return { allowed: false, reason: "safety_verification_ambiguous" };
  if (severity === "critical") return { allowed: false, reason: "safety_critical_terminate_bound" };
  return { allowed: true, reason: "verified" };
}

function numeric(value: string | number | null): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safetySeverity(value: unknown): "low" | "medium" | "high" | "critical" | undefined {
  let parsed = value;
  if (typeof parsed === "string") try { parsed = JSON.parse(parsed) as unknown; } catch { return undefined; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const severity = (parsed as Record<string, unknown>)["severity"];
  return severity === "low" || severity === "medium" || severity === "high" || severity === "critical" ? severity : undefined;
}

function blocked(protectedNodeKey: string, reason: string): NodeExecutionResult {
  return { output: { activeSuccessors: [], verification_status: "blocked_pending_recovery", blocked_successor: protectedNodeKey, reason }, metadata: { execution_status: "blocked_pending_recovery" } };
}
