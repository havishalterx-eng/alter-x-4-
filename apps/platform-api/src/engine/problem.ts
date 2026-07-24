import { randomBytes } from "node:crypto";
import { HttpException } from "@nestjs/common";
import {
  ProblemDetailsSchema,
  type ProblemDetails,
} from "@alterx/contracts";

export class EngineProblemError extends HttpException {
  constructor(readonly problem: ProblemDetails) {
    super(problem, problem.status);
  }
}

export async function engineProblemFromResponse(
  response: Response,
  instance: string,
): Promise<ProblemDetails> {
  const body = await readJson(response);
  const parsed = ProblemDetailsSchema.safeParse(body);
  if (parsed.success && parsed.data.status === response.status) {
    return parsed.data;
  }

  return upstreamProblem(response.status, instance, "UPSTREAM_SERVICE_ERROR");
}

export function upstreamProblem(
  status: number,
  instance: string,
  errorCode: "UPSTREAM_SERVICE_ERROR" | "UPSTREAM_TIMEOUT",
): ProblemDetails {
  const boundedStatus = status >= 400 && status <= 599 ? status : 502;
  const timeout = errorCode === "UPSTREAM_TIMEOUT";
  return {
    type: `https://errors.alter.ai/${timeout ? "upstream-timeout" : "upstream-service-error"}`,
    title: timeout ? "Upstream timeout" : "Upstream service error",
    status: boundedStatus,
    detail: timeout
      ? "Upstream service did not respond before timeout."
      : "Upstream service request failed.",
    instance,
    error_code: errorCode,
    trace_id: `trc_${uuidV7()}`,
    request_id: `req_${uuidV7()}`,
    retryable: boundedStatus >= 500,
    field_errors: [],
    documentation_key: timeout
      ? "upstream.timeout"
      : "upstream.service-error",
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function uuidV7(): string {
  const bytes = randomBytes(16);
  const timestamp = Date.now();
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
