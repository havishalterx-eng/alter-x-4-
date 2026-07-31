import { ModelAliasSchema, type NodeType } from "@alterx/contracts";
import type { ModelGatewayHandler } from "@alterx/adapters";
import { ModelGatewayInvalidResponseError } from "@alterx/shared-clients";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";
import type { VerificationGateReader, VerificationResultRecord } from "../verification-gate-reader";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface InputVerdict {
  readonly sourceNodeKey: string;
  readonly verified: boolean;
  readonly reason: string;
}

/**
 * Same pass/fail semantics as gate.handler.ts's verification gate (quality
 * verdict "pass" with score >= threshold in [0,1], safety severity not
 * "critical") -- intentionally re-derived here rather than imported, since
 * Synthesis's job differs from Gate's: Gate blocks an external action
 * outright, Synthesis still assembles a flagged partial from what didn't
 * verify. Known small duplication, not shared to keep this ticket's blast
 * radius to the Synthesis handler alone.
 */
function classifyVerification(results: readonly VerificationResultRecord[]): { readonly verified: boolean; readonly reason: string } {
  if (results.length === 0) return { verified: false, reason: "verification_result_missing" };
  const quality = results.find((result) => result.gateType === "quality");
  const safety = results.find((result) => result.gateType === "safety");
  if (quality === undefined) return { verified: false, reason: "verification_result_missing" };
  const score = numeric(quality.score);
  const threshold = numeric(quality.threshold);
  if (
    quality.verdict !== "pass" ||
    score === undefined ||
    threshold === undefined ||
    score < threshold ||
    threshold < 0 ||
    threshold > 1 ||
    score < 0 ||
    score > 1
  ) {
    return { verified: false, reason: "quality_verification_failed" };
  }
  if (safety !== undefined) {
    const severity = safetySeverity(safety.details);
    if (severity === "critical") return { verified: false, reason: "safety_critical" };
  }
  return { verified: true, reason: "verified" };
}

function numeric(value: string | number | null): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safetySeverity(value: unknown): "low" | "medium" | "high" | "critical" | undefined {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const severity = (parsed as Record<string, unknown>)["severity"];
  return severity === "low" || severity === "medium" || severity === "high" || severity === "critical"
    ? severity
    : undefined;
}

/**
 * Synthesis: merges every verified upstream node output into one coherent
 * deliverable via the Model Gateway (ADVANCED tier, fixed -- this is a
 * system operation, not a workflow-authored prompt, so config carries no
 * model_alias/prompt of its own; see node-type-catalog.ts's empty
 * configSchema for Synthesis).
 *
 * Graceful degrade (doc 11 Output Phase): inputs that fail verification, or
 * have no verification result at all, are never silently merged in as if
 * they were fine. They're excluded from the Model Gateway call and listed
 * in output.gaps so the deliverable is an honest partial, not a clean-
 * looking fabrication.
 *
 * If NO input verifies, there is nothing honest to synthesize -- this
 * reuses the existing "blocked_pending_recovery" contract nodeexec.service
 * already handles generically (ledger + Recovery Policy Engine trigger)
 * rather than inventing a new terminal status, since editing
 * nodeexec.service.ts's status handling is outside this ticket's declared
 * path (Executor/nodeexec wiring is Execution-phase scope).
 */
export class SynthesisHandler implements NodeHandler {
  readonly nodeType: NodeType = "Synthesis";

  constructor(
    private readonly modelGateway: ModelGatewayHandler,
    private readonly verificationReader: VerificationGateReader,
  ) {}

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    if (
      context.tenant_id === undefined ||
      context.run_id === undefined ||
      context.node_execution_id === undefined
    ) {
      throw new NodeHandlerValidationError(
        "Synthesis requires tenant_id, run_id, and node_execution_id on the execution context",
      );
    }

    const upstreamKeys = Object.keys(context.inputs).sort();
    if (upstreamKeys.length === 0) {
      throw new NodeHandlerValidationError(
        "Synthesis requires at least one upstream input",
      );
    }

    // Fan out, not N sequential round-trips -- a Synthesis node can have
    // many upstream branches (that's the point of the node), so awaiting
    // one findForSourceNode call at a time here would be a real N+1 against
    // Postgres on every synthesis.
    const verdicts: InputVerdict[] = await Promise.all(
      upstreamKeys.map(async (sourceNodeKey) => {
        const results = await this.verificationReader.findForSourceNode({
          tenantId: context.tenant_id as string,
          runId: context.run_id as string,
          sourceNodeKey,
        });
        const { verified, reason } = classifyVerification(results);
        return { sourceNodeKey, verified, reason };
      }),
    );

    const verifiedKeys = verdicts.filter((v) => v.verified).map((v) => v.sourceNodeKey);
    const gaps = verdicts
      .filter((v) => !v.verified)
      .map((v) => ({ source_node_key: v.sourceNodeKey, reason: v.reason }));

    if (verifiedKeys.length === 0) {
      return {
        output: {
          synthesized: false,
          gaps,
          reason: "no_verified_inputs",
        },
        metadata: { execution_status: "blocked_pending_recovery" },
      };
    }

    const verifiedInputs: Record<string, Record<string, unknown>> = {};
    for (const key of verifiedKeys) {
      verifiedInputs[key] = context.inputs[key] ?? {};
    }

    const modelRequest = {
      tenant_id: context.tenant_id,
      run_id: context.run_id,
      node_execution_id: context.node_execution_id,
      model_alias: ModelAliasSchema.parse("ADVANCED"),
      input_json: JSON.stringify({
        task: "synthesize_deliverable",
        inputs: verifiedInputs,
      }),
    };
    const response = await this.modelGateway.invoke(modelRequest);

    let parsedDeliverable: unknown;
    try {
      parsedDeliverable = JSON.parse(response.output_json);
    } catch (error: unknown) {
      throw new ModelGatewayInvalidResponseError(
        `output_json is not valid JSON: ${(error as Error).message}`,
      );
    }
    if (!isPlainObject(parsedDeliverable)) {
      throw new ModelGatewayInvalidResponseError("output_json must parse to an object");
    }

    let usage: unknown = {};
    try {
      usage = JSON.parse(response.usage_json);
    } catch {
      usage = {};
    }

    return {
      output: {
        deliverable: parsedDeliverable,
        degraded: gaps.length > 0,
        gaps,
      },
      metadata: {
        usage,
        ...(response.resolved_capability === undefined
          ? {}
          : { resolved_capability: response.resolved_capability }),
      },
    };
  }
}
