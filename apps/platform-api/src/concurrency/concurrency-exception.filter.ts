import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ConcurrencyHttpError } from "./problem";

@Catch(ConcurrencyHttpError)
export class ConcurrencyExceptionFilter implements ExceptionFilter {
  catch(error: ConcurrencyHttpError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
