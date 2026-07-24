import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { IdempotencyHttpError } from "./problem";

@Catch(IdempotencyHttpError)
export class IdempotencyExceptionFilter implements ExceptionFilter {
  catch(error: IdempotencyHttpError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
