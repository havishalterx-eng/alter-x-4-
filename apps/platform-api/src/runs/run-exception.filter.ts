import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { RunHttpError } from "./problem";

@Catch(RunHttpError)
export class RunExceptionFilter implements ExceptionFilter {
  catch(error: RunHttpError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
