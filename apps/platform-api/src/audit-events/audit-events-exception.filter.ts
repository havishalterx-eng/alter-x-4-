import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuditEventsHttpError } from "./problem";

@Catch(AuditEventsHttpError)
export class AuditEventsExceptionFilter implements ExceptionFilter {
  catch(error: AuditEventsHttpError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<FastifyReply>()
      .status(error.getStatus()).type("application/problem+json").send(error.getResponse());
  }
}
