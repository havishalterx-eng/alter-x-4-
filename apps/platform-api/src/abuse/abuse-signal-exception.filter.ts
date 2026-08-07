import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AbuseSignalsHttpError } from "./problem";

@Catch(AbuseSignalsHttpError)
export class AbuseSignalExceptionFilter implements ExceptionFilter {
  catch(error: AbuseSignalsHttpError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    http.getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send({ ...(error.getResponse() as object), instance: request.url });
  }
}
