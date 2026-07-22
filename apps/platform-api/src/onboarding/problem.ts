import { HttpException } from "@nestjs/common";

export class OnboardingHttpError extends HttpException {
  constructor(status: number, errorCode: string, detail: string) {
    super(
      {
        type: `https://errors.alter.ai/${errorCode.toLowerCase()}`,
        title: errorCode,
        status,
        detail,
        instance: "/api/v1/onboarding",
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
