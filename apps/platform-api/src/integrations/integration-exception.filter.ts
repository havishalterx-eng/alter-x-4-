import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { IntegrationHttpError } from "./problem";

@Catch(IntegrationHttpError)
export class IntegrationExceptionFilter implements ExceptionFilter {
  catch(error: IntegrationHttpError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const problem = error.getResponse() as Record<string, unknown>;
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send({ ...problem, instance: request.url });
  }
}
