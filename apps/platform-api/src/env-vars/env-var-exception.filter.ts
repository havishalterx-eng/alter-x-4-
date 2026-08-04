import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { EnvVarHttpError } from "./problem";

@Catch(EnvVarHttpError)
export class EnvVarExceptionFilter implements ExceptionFilter {
  catch(error: EnvVarHttpError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
