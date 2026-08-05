import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AdminPolicyHttpError } from "./problem";

@Catch(AdminPolicyHttpError)
export class AdminPolicyExceptionFilter implements ExceptionFilter {
  catch(error: AdminPolicyHttpError, host: ArgumentsHost): void {
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
