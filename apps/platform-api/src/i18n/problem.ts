import { HttpException } from "@nestjs/common";

export class I18nHttpError extends HttpException {
  constructor(status: number, errorCode: string, detail: string, instance: string) {
    super(
      {
        type: `https://errors.alter.ai/${errorCode.toLowerCase()}`,
        title: errorCode,
        status,
        detail,
        instance,
        error_code: errorCode,
        trace_id: "trace-unavailable",
        request_id: "request-unavailable",
        retryable: false,
        field_errors: [],
        documentation_key: errorCode,
      },
      status,
    );
  }
}
