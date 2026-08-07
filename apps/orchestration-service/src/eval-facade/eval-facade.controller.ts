import { createHash, timingSafeEqual } from "node:crypto";

import { Body, Controller, Headers, HttpCode, Inject, Post, UseFilters } from "@nestjs/common";
import { Public as BypassSessionGatewayActorAuth } from "@alterx/auth";

import { EvalFacadeExceptionFilter } from "./exception.filter";
import {
  type CheckReleaseGateInput,
  EvalFacadeService,
  type RunEvaluationInput,
} from "./eval-facade.service";
import { EvalFacadeHttpError } from "./problem";

export const EVAL_FACADE_TOKEN_HASH = Symbol("EVAL_FACADE_TOKEN_HASH");

@BypassSessionGatewayActorAuth()
@UseFilters(EvalFacadeExceptionFilter)
@Controller("internal/eval")
export class EvalFacadeController {
  constructor(
    private readonly service: EvalFacadeService,
    @Inject(EVAL_FACADE_TOKEN_HASH)
    private readonly tokenHash: string,
  ) {}

  @Post("run-evaluation")
  @HttpCode(200)
  runEvaluation(
    @Body() body: unknown,
    @Headers("authorization") authorization: string | undefined,
  ) {
    this.authorize(authorization, "/internal/eval/run-evaluation");
    return this.service.runEvaluation(parseRunEvaluation(body, "/internal/eval/run-evaluation"));
  }

  @Post("check-release-gate")
  @HttpCode(200)
  checkReleaseGate(
    @Body() body: unknown,
    @Headers("authorization") authorization: string | undefined,
  ) {
    this.authorize(authorization, "/internal/eval/check-release-gate");
    return this.service.checkReleaseGate(parseCheckReleaseGate(body, "/internal/eval/check-release-gate"));
  }

  private authorize(authorization: string | undefined, instance: string): void {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const actual = createHash("sha256").update(token).digest();
    const expected = Buffer.from(this.tokenHash, "hex");
    if (!token || expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      throw new EvalFacadeHttpError(401, "EVAL_FACADE_AUTHENTICATION_FAILED", "Internal service authentication failed", instance);
    }
  }
}

function parseRunEvaluation(value: unknown, instance: string): RunEvaluationInput {
  if (!isRecord(value) || !nonEmptyString(value.golden_set_name)) {
    throw new EvalFacadeHttpError(400, "EVAL_FACADE_VALIDATION_FAILED", "golden_set_name is required", instance);
  }
  if (value.trigger !== undefined && !nonEmptyString(value.trigger)) {
    throw new EvalFacadeHttpError(400, "EVAL_FACADE_VALIDATION_FAILED", "trigger must be a non-empty string when provided", instance);
  }
  return {
    golden_set_name: value.golden_set_name,
    ...(value.trigger !== undefined ? { trigger: value.trigger as string } : {}),
  };
}

function parseCheckReleaseGate(value: unknown, instance: string): CheckReleaseGateInput {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.release_gate_key) ||
    !nonEmptyString(value.evaluation_run_id)
  ) {
    throw new EvalFacadeHttpError(400, "EVAL_FACADE_VALIDATION_FAILED", "release_gate_key and evaluation_run_id are required", instance);
  }
  return {
    release_gate_key: value.release_gate_key,
    evaluation_run_id: value.evaluation_run_id,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
