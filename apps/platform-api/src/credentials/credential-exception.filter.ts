import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CredentialHttpError } from "./problem";
import { RegionMismatchError } from "./region-enforcement";

@Catch(CredentialHttpError, RegionMismatchError)
export class CredentialExceptionFilter implements ExceptionFilter {
  catch(error: CredentialHttpError | RegionMismatchError, host: ArgumentsHost): void {
    const problem =
      error instanceof RegionMismatchError
        ? new CredentialHttpError(
            403,
            "CREDENTIAL_REGION_DENIED",
            error.message,
            host.switchToHttp().getRequest<FastifyRequest>().url,
          )
        : error;

    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(problem.getStatus())
      .type("application/problem+json")
      .send(problem.getResponse());
  }
}
