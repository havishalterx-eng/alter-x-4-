import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { NotificationHttpError } from "./problem";

@Catch(NotificationHttpError)
export class NotificationExceptionFilter implements ExceptionFilter {
  catch(error: NotificationHttpError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(error.getStatus())
      .type("application/problem+json")
      .send(error.getResponse());
  }
}
