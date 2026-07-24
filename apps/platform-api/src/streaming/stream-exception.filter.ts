import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { StreamProblemError } from "./problem";

@Catch(StreamProblemError)
export class StreamExceptionFilter implements ExceptionFilter {
  catch(error: StreamProblemError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    reply
      .status(error.problem.status)
      .type("application/problem+json")
      .send({ ...error.problem, instance: request.url });
  }
}
