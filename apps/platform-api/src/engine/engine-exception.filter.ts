import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { EngineProblemError } from "./problem";

@Catch(EngineProblemError)
export class EngineExceptionFilter implements ExceptionFilter {
  catch(error: EngineProblemError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
