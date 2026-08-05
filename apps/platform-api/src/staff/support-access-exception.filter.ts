import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { PlatformHttpError } from "../signup/problem";

@Catch(PlatformHttpError)
export class SupportAccessExceptionFilter implements ExceptionFilter {
  catch(error: PlatformHttpError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
