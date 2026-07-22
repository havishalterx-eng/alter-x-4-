import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { RbacDeniedError } from "./problem";

@Catch(RbacDeniedError)
export class RbacExceptionFilter implements ExceptionFilter {
  catch(error: RbacDeniedError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply.status(403).type("application/problem+json").send(error.problem);
  }
}
