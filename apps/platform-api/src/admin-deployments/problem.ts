import { HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export class AdminDeploymentHttpError extends HttpException {
  constructor(status: number, code: string, detail: string, instance: string) {
    super({
      type: `https://alter.dev/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title: code,
      status,
      detail,
      instance,
      error_code: code,
      trace_id: generatedId("trc"),
      request_id: generatedId("req"),
      retryable: false,
      field_errors: [],
      documentation_key: "deployment.admin",
    }, status);
  }
}

function generatedId(prefix: "trc" | "req"): string {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}
