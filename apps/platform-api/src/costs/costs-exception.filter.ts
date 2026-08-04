import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CostsHttpError } from "./problem";

@Catch(CostsHttpError)
export class CostsExceptionFilter implements ExceptionFilter {
  catch(error: CostsHttpError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
