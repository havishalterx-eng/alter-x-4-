import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { BenchmarksHttpError } from "./problem";

@Catch(BenchmarksHttpError)
export class BenchmarksExceptionFilter implements ExceptionFilter {
  catch(error: BenchmarksHttpError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send({ ...(error.getResponse() as object), instance: request.url });
  }
}
