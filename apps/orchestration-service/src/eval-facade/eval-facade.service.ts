import { Injectable } from "@nestjs/common";
import {
  EvalServiceClient,
  EvalServiceClientError,
} from "@alterx/adapters";
import type {
  EvalCheckReleaseGateResponse,
  EvalRunEvaluationResponse,
} from "@alterx/contracts";

import { EvalFacadeHttpError } from "./problem";

export interface RunEvaluationInput {
  readonly golden_set_name: string;
  readonly trigger?: string;
}

export interface CheckReleaseGateInput {
  readonly release_gate_key: string;
  readonly evaluation_run_id: string;
}

@Injectable()
export class EvalFacadeService {
  constructor(private readonly client: EvalServiceClient) {}

  async runEvaluation(
    input: RunEvaluationInput,
  ): Promise<EvalRunEvaluationResponse> {
    return this.withUpstreamErrors("/internal/eval/run-evaluation", () =>
      this.client.runEvaluation({
        golden_set_name: input.golden_set_name,
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
      }),
    );
  }

  async checkReleaseGate(
    input: CheckReleaseGateInput,
  ): Promise<EvalCheckReleaseGateResponse> {
    return this.withUpstreamErrors("/internal/eval/check-release-gate", () =>
      this.client.checkReleaseGate(input),
    );
  }

  private async withUpstreamErrors<T>(
    instance: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!(error instanceof EvalServiceClientError)) {
        throw new EvalFacadeHttpError(502, "EVAL_FACADE_UPSTREAM_ERROR", "Evaluation service is unavailable", instance);
      }
      if (error.code === "invalid_argument") {
        throw new EvalFacadeHttpError(400, "EVAL_FACADE_VALIDATION_FAILED", "Evaluation request was rejected", instance);
      }
      if (error.code === "not_found") {
        throw new EvalFacadeHttpError(404, "EVAL_FACADE_NOT_FOUND", "Evaluation resource was not found", instance);
      }
      if (error.code === "failed_precondition") {
        throw new EvalFacadeHttpError(409, "EVAL_FACADE_PRECONDITION_FAILED", "Evaluation precondition was not met", instance);
      }
      if (error.code === "deadline_exceeded") {
        throw new EvalFacadeHttpError(504, "EVAL_FACADE_UPSTREAM_ERROR", "Evaluation service timed out", instance);
      }
      throw new EvalFacadeHttpError(502, "EVAL_FACADE_UPSTREAM_ERROR", "Evaluation service is unavailable", instance);
    }
  }
}
