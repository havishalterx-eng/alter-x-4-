import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { IncidentHttpError } from "./problem";

@Catch(IncidentHttpError)
export class IncidentExceptionFilter implements ExceptionFilter {
  catch(error: IncidentHttpError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
