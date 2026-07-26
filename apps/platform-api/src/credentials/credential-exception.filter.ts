import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CredentialHttpError } from "./problem";

@Catch(CredentialHttpError)
export class CredentialExceptionFilter implements ExceptionFilter {
  catch(error: CredentialHttpError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
