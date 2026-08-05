import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { EvalFacadeHttpError } from "./problem";

@Catch(EvalFacadeHttpError)
export class EvalFacadeExceptionFilter implements ExceptionFilter {
  catch(error: EvalFacadeHttpError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
