import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { WorkflowHttpError } from "./problem";

@Catch(WorkflowHttpError)
export class WorkflowExceptionFilter implements ExceptionFilter {
  catch(error: WorkflowHttpError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
