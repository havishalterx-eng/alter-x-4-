import { HttpException } from "@nestjs/common";

export class DiscoveryHttpError extends HttpException {
  constructor(
    status: number,
    errorCode: string,
    detail: string,
    instance: string,
  ) {
    super(
      {
        type: `https://alter.dev/problems/${errorCode.toLowerCase().replaceAll("_", "-")}`,
        title: status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request",
        status,
        detail,
        instance,
        error_code: errorCode,
        retryable: status >= 500,
      },
      status,
    );
  }
}
