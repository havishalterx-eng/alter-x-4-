import { Injectable } from "@nestjs/common";

import type { EngineConfig } from "./config";
import {
  EngineProblemError,
  engineProblemFromResponse,
  upstreamProblem,
} from "./problem";

export interface RunEvaluationRequest {
  readonly golden_set_name: string;
}

export interface RunEvaluationResponse {
  readonly evaluation_run_id: string;
  readonly status: string;
  readonly results_json: string;
}

export interface CheckReleaseGateRequest {
  readonly release_gate_key: string;
  readonly evaluation_run_id: string;
}

export interface CheckReleaseGateResponse {
  readonly passed: boolean;
  readonly failed_thresholds: readonly string[];
}

export type EvalFacadeSecretResolver = (reference: string) => Promise<string>;

@Injectable()
export class EvalFacadeClient {
  constructor(
    private readonly config: EngineConfig,
    private readonly resolveSecret: EvalFacadeSecretResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async runEvaluation(
    input: RunEvaluationRequest,
    traceparent: string | undefined,
  ): Promise<RunEvaluationResponse> {
    const instance = "/api/v1/admin/benchmarks/actions/run";
    const response = await this.request(
      "/internal/eval/run-evaluation",
      input,
      traceparent,
      instance,
    );
    return parseResponse(response, instance, isRunEvaluationResponse) as Promise<RunEvaluationResponse>;
  }

  async checkReleaseGate(
    input: CheckReleaseGateRequest,
    traceparent: string | undefined,
  ): Promise<CheckReleaseGateResponse> {
    const instance = `/api/v1/admin/benchmarks/release-gates/${encodeURIComponent(input.release_gate_key)}`;
    const response = await this.request(
      "/internal/eval/check-release-gate",
      input,
      traceparent,
      instance,
    );
    return parseResponse(response, instance, isCheckReleaseGateResponse) as Promise<CheckReleaseGateResponse>;
  }

  private async request(
    path: "/internal/eval/run-evaluation" | "/internal/eval/check-release-gate",
    body: RunEvaluationRequest | CheckReleaseGateRequest,
    traceparent: string | undefined,
    instance: string,
  ): Promise<Response> {
    let token: string;
    try {
      token = await this.resolveSecret(this.config.evalFacadeTokenRef);
    } catch {
      throw new EngineProblemError(upstreamProblem(502, instance, "UPSTREAM_SERVICE_ERROR"));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json, application/problem+json",
          "content-type": "application/json",
          ...(traceparent ? { traceparent } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) return response;
      if (response.status === 401) {
        throw new EngineProblemError(upstreamProblem(502, instance, "UPSTREAM_SERVICE_ERROR"));
      }
      throw new EngineProblemError(await engineProblemFromResponse(response, instance));
    } catch (error: unknown) {
      if (error instanceof EngineProblemError) throw error;
      throw new EngineProblemError(
        upstreamProblem(
          isAbortError(error) ? 504 : 502,
          instance,
          isAbortError(error) ? "UPSTREAM_TIMEOUT" : "UPSTREAM_SERVICE_ERROR",
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseResponse(
  response: Response,
  instance: string,
  valid: (value: unknown) => boolean,
): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    if (!valid(body)) throw new Error("invalid Eval facade response");
    return body;
  } catch {
    throw new EngineProblemError(upstreamProblem(502, instance, "UPSTREAM_SERVICE_ERROR"));
  }
}

function isRunEvaluationResponse(value: unknown): value is RunEvaluationResponse {
  return isRecord(value) && nonEmptyString(value.evaluation_run_id) && nonEmptyString(value.status) && typeof value.results_json === "string";
}

function isCheckReleaseGateResponse(value: unknown): value is CheckReleaseGateResponse {
  return isRecord(value) && typeof value.passed === "boolean" && Array.isArray(value.failed_thresholds) && value.failed_thresholds.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
