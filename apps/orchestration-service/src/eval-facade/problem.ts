import { randomBytes } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { ProblemDetailsSchema, type ProblemDetails } from "@alterx/contracts";

export class EvalFacadeHttpError extends HttpException {
  constructor(
    status: 400 | 401 | 404 | 409 | 502 | 504,
    errorCode: string,
    detail: string,
    instance: string,
  ) {
    super(problem(status, errorCode, detail, instance), status);
  }
}

function problem(
  status: 400 | 401 | 404 | 409 | 502 | 504,
  errorCode: string,
  detail: string,
  instance: string,
): ProblemDetails {
  return ProblemDetailsSchema.parse({
    type: `https://alter.dev/problems/${errorCode.toLowerCase().replaceAll("_", "-")}`,
    title:
      status === 400 ? "Bad Request"
      : status === 401 ? "Unauthorized"
      : status === 404 ? "Not Found"
      : status === 409 ? "Conflict"
      : status === 502 ? "Bad Gateway"
      : "Gateway Timeout",
    status,
    detail,
    instance,
    error_code: errorCode,
    trace_id: generatedId("trc"),
    request_id: generatedId("req"),
    retryable: status >= 500,
    field_errors: [],
    documentation_key: "eval.facade",
  });
}

function generatedId(prefix: "trc" | "req"): string {
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
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
